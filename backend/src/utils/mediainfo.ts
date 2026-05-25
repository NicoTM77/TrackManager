import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import logger from './logger';

const execFileAsync = promisify(execFile);

export interface ParsedAudioTrack {
  trackIndex: number;
  language: string | null;
  format: string;
  channels: number | null;
  bitrate: number | null;
  isDefault: boolean;
  isForced: boolean;
}

export interface ParsedSubtitleTrack {
  trackIndex: number;
  language: string | null;
  format: string;
  isDefault: boolean;
  isForced: boolean;
  isHearingImpaired: boolean;
}

export interface ParsedMediaMetadata {
  container: string;
  fileSize: number;
  title: string | null;
  season: number | null;
  episode: number | null;
  videoResolution: string | null;
  videoBitrate: number | null;
  videoCodec: string | null;
  videoColorDepth: number | null;
  videoHdrFormat: string | null;
  audioTracks: ParsedAudioTrack[];
  subtitleTracks: ParsedSubtitleTrack[];
  rawMetadata: string;
}

/**
 * Normalizes 2-letter ISO codes to standard 3-letter codes for robust rule matching.
 */
function normalizeLanguage(lang: any): string | null {
  if (!lang) return null;
  const l = String(lang).trim().toLowerCase();
  if (l.length === 2) {
    const commonMap: Record<string, string> = {
      en: 'eng',
      de: 'ger',
      fr: 'fre',
      es: 'spa',
      it: 'ita',
      ja: 'jpn',
      ru: 'rus',
      zh: 'zho',
      nl: 'nld',
      ko: 'kor',
      pl: 'pol',
      pt: 'por',
      sv: 'swe',
      no: 'nor',
      da: 'dan',
      fi: 'fin',
    };
    return commonMap[l] || l;
  }
  return l;
}

/**
 * Safe conversion for boolean values in MediaInfo ("Yes"/"No" strings).
 */
function parseBool(val: any): boolean {
  if (!val) return false;
  return String(val).trim().toLowerCase() === 'yes';
}

/**
 * Executes the `mediainfo` CLI utility and parses deep metadata into type-safe Drizzle models.
 * Gracefully handles missing, unexpected, or malformed values.
 *
 * @param filePath Absolute path to the media file on disk.
 */
export async function parseMediaFile(filePath: string): Promise<ParsedMediaMetadata> {
  logger.debug(`Probing media file with MediaInfo CLI: ${filePath}`);
  
  let stdout: string;
  try {
    // Run mediainfo with arguments as an array to prevent shell injection/quoting issues
    const { stdout: rawOutput } = await execFileAsync('mediainfo', ['--Output=JSON', filePath], {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer to handle massive metadata payloads safely
    });
    stdout = rawOutput;
    logger.trace(`MediaInfo output successfully retrieved. Raw payload size: ${stdout.length} characters.`);
  } catch (error: any) {
    logger.error(`MediaInfo CLI execution failed for "${filePath}":`, error.message);
    throw new Error(`MediaInfo execution failed: ${error.message}`);
  }

  let rootJson: any;
  try {
    rootJson = JSON.parse(stdout);
  } catch (error: any) {
    logger.error(`MediaInfo returned invalid JSON for "${filePath}":`, error.message);
    throw new Error(`Invalid JSON output from MediaInfo: ${error.message}`);
  }

  const tracks = rootJson?.media?.track;
  if (!Array.isArray(tracks)) {
    logger.error({ keys: Object.keys(rootJson || {}) }, `MediaInfo tracks format is invalid for "${filePath}"`);
    throw new Error(`Invalid MediaInfo output: 'media.track' is missing or not an array`);
  }

  // 1. Parse General Track (Container, FileSize, etc.)
  const generalTrack = tracks.find((t: any) => t['@type'] === 'General') || {};
  const container = (generalTrack.Format || path.extname(filePath).replace('.', '')).toLowerCase();
  const fileSize = parseInt(generalTrack.FileSize, 10) || 0;
  
  // Extract Title and Season/Episode information
  const fileName = path.basename(filePath);
  const titleField = generalTrack.Title || generalTrack.Movie || null;
  let title = titleField ? String(titleField).trim() : null;

  // TV Shows parse Season and Episode numbers from filename/path (e.g. S01E02)
  const s00e00Regex = /S(\d+)E(\d+)/i;
  const s00e00Match = s00e00Regex.exec(fileName);
  let season: number | null = null;
  let episode: number | null = null;

  if (s00e00Match) {
    season = parseInt(s00e00Match[1], 10);
    episode = parseInt(s00e00Match[2], 10);
  } else {
    // Fallback: search parent folders for ".../Season 03/..."
    const parentFolderMatch = /Season\s+(\d+)/i.exec(filePath);
    if (parentFolderMatch) {
      season = parseInt(parentFolderMatch[1], 10);
    }
  }

  // If no title is extracted from metadata, use file name without extension
  if (!title) {
    title = path.basename(fileName, path.extname(fileName));
  }

  // 2. Parse Video Track (Resolution, Codec, HDR Profile, Color Depth)
  const videoTrack = tracks.find((t: any) => t['@type'] === 'Video');
  let videoResolution: string | null = null;
  let videoBitrate: number | null = null;
  let videoCodec: string | null = null;
  let videoColorDepth: number | null = null;
  let videoHdrFormat = 'SDR';

  if (videoTrack) {
    const width = parseInt(videoTrack.Width, 10);
    const height = parseInt(videoTrack.Height, 10);
    if (width && height) {
      videoResolution = `${width}x${height}`;
    }

    videoBitrate = parseInt(videoTrack.BitRate || videoTrack.BitRate_Nominal, 10) || null;
    videoCodec = videoTrack.Format ? String(videoTrack.Format).toUpperCase() : null;
    videoColorDepth = parseInt(videoTrack.BitDepth, 10) || null;

    // Detect HDR profiles robustly across standard, compatibility, and commercial properties
    const hdrCommercial = String(videoTrack.HDR_Format_Commercial || '').toLowerCase();
    const hdrFormat = String(videoTrack.HDR_Format || '').toLowerCase();
    const hdrProfile = String(videoTrack.HDR_Format_Profile || '').toLowerCase();
    const hdrComp = String(videoTrack.HDR_Format_Compatibility || '').toLowerCase();

    const combinedHdrInfo = `${hdrCommercial} ${hdrFormat} ${hdrProfile} ${hdrComp}`;

    if (combinedHdrInfo.includes('dolby vision')) {
      videoHdrFormat = 'Dolby Vision';
    } else if (combinedHdrInfo.includes('hdr10+')) {
      videoHdrFormat = 'HDR10+';
    } else if (
      combinedHdrInfo.includes('hdr10') || 
      combinedHdrInfo.includes('smpte st 2086') || 
      combinedHdrInfo.includes('smpte st 2094')
    ) {
      videoHdrFormat = 'HDR10';
    } else if (
      combinedHdrInfo.includes('hlg') || 
      combinedHdrInfo.includes('arib std-b67')
    ) {
      videoHdrFormat = 'HLG';
    } else if (
      combinedHdrInfo.includes('hdr') || 
      videoColorDepth === 10 || 
      videoColorDepth === 12
    ) {
      // Fallback for color depths above 8-bit that might be general HDR
      videoHdrFormat = 'HDR';
    }
  }

  // 3. Parse Audio Tracks
  const audioTracksList = tracks.filter((t: any) => t['@type'] === 'Audio');
  const audioTracks: ParsedAudioTrack[] = audioTracksList.map((track: any, idx: number) => {
    // Detect Atmos in commercial format name
    const formatName = String(track.Format || 'UNKNOWN');
    const commercialName = String(track.Format_Commercial_IfAny || '');
    let format = formatName;
    if (commercialName.toLowerCase().includes('dolby atmos') || formatName.toLowerCase().includes('atmos')) {
      format = `${formatName} (Atmos)`;
    }

    return {
      trackIndex: parseInt(track.ID, 10) || idx + 1,
      language: normalizeLanguage(track.Language),
      format,
      channels: parseInt(track.Channels, 10) || null,
      bitrate: parseInt(track.BitRate, 10) || null,
      isDefault: parseBool(track.Default),
      isForced: parseBool(track.Forced),
    };
  });

  // 4. Parse Subtitle Tracks
  const subtitleTracksList = tracks.filter((t: any) => t['@type'] === 'Subtitle');
  const subtitleTracks: ParsedSubtitleTrack[] = subtitleTracksList.map((track: any, idx: number) => {
    return {
      trackIndex: parseInt(track.ID, 10) || idx + 1,
      language: normalizeLanguage(track.Language),
      format: String(track.Format || 'SRT').toUpperCase(),
      isDefault: parseBool(track.Default),
      isForced: parseBool(track.Forced),
      isHearingImpaired: parseBool(track.HearingImpaired) || parseBool(track.Hearing_Impaired),
    };
  });

  logger.trace(`Probed media file successfully: container=${container}, res=${videoResolution || 'SD'}, audioTracksCount=${audioTracks.length}, subtitleTracksCount=${subtitleTracks.length}`);

  return {
    container,
    fileSize,
    title,
    season,
    episode,
    videoResolution,
    videoBitrate,
    videoCodec,
    videoColorDepth,
    videoHdrFormat,
    audioTracks,
    subtitleTracks,
    rawMetadata: stdout, // Dump the full JSON output of MediaInfo for future-proofing / deep auditing
  };
}
