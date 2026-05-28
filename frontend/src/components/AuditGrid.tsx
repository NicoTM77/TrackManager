import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface AudioTrack {
  id: number;
  trackIndex: number;
  language: string | null;
  format: string;
  channels: number | null;
  bitrate: number | null;
  isDefault: boolean;
  isForced: boolean;
}

interface SubtitleTrack {
  id: number;
  trackIndex: number;
  language: string | null;
  format: string;
  isDefault: boolean;
  isForced: boolean;
  isHearingImpaired: boolean;
}

interface AuditResult {
  mediaItemId: number;
  ruleId: number;
  ruleName: string;
  passed: boolean;
  errorMessage: string | null;
  auditedAt: string;
}

interface MediaItem {
  id: number;
  libraryId: number;
  filePath: string;
  fileName: string;
  fileSize: number;
  mtimeMs: number;
  status: 'active' | 'removed';
  scannedAt: string;
  title: string | null;
  season: number | null;
  episode: number | null;
  container: string;
  videoResolution: string | null;
  videoBitrate: number | null;
  videoCodec: string | null;
  videoColorDepth: number | null;
  videoHdrFormat: string | null;
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  auditResults: AuditResult[];
}

interface Library {
  id: number;
  name: string;
  type: string;
}

interface AuditGridProps {
  apiBase: string;
  initialLibraryId?: number;
  initialFailedOnly?: boolean;
}

export const AuditGrid: React.FC<AuditGridProps> = ({ apiBase, initialLibraryId, initialFailedOnly }) => {
  const { t } = useTranslation();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [mediaData, setMediaData] = useState<{ items: MediaItem[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);

  // Filter States
  const [search, setSearch] = useState('');
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>(initialLibraryId ? String(initialLibraryId) : '');
  const [videoQuality, setVideoQuality] = useState('');
  const [failedOnly, setFailedOnly] = useState(initialFailedOnly ?? false);
  const [page, setPage] = useState(1);
  const limit = 20;

  // Drawer & Accordion States
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [rawMetadata, setRawMetadata] = useState<any>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Accordion active items inside drawer
  const [activeAccordion, setActiveAccordion] = useState<string | null>('compliance');

  // Load libraries on mount
  useEffect(() => {
    fetch(`${apiBase}/api/libraries`)
      .then(res => res.json())
      .then(data => setLibraries(data))
      .catch(err => console.error('Failed to load libraries:', err));
  }, [apiBase]);

  // Fetch paginated media items when filters change
  const fetchMedia = async () => {
    setLoading(true);
    const offset = (page - 1) * limit;
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      status: 'active'
    });

    if (search) params.append('search', search);
    if (selectedLibraryId) params.append('libraryId', selectedLibraryId);
    if (videoQuality) params.append('videoQuality', videoQuality);
    if (failedOnly) params.append('failedOnly', 'true');

    try {
      const res = await fetch(`${apiBase}/api/media?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setMediaData(data);
      }
    } catch (err) {
      console.error('Failed to fetch media:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMedia();
  }, [apiBase, search, selectedLibraryId, videoQuality, failedOnly, page]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, selectedLibraryId, videoQuality, failedOnly]);

  const handleRowClick = async (item: MediaItem) => {
    setSelectedItem(item);
    setIsDrawerOpen(true);
    setRawMetadata(null);
    setCopied(false);
    setActiveAccordion('compliance');

    // Fetch raw MediaInfo details
    setRawLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/media/${item.id}/raw`);
      if (res.ok) {
        const rawJson = await res.json();
        setRawMetadata(rawJson);
      }
    } catch (err) {
      console.error('Failed to load raw metadata:', err);
    } finally {
      setRawLoading(false);
    }
  };

  const handleCopyRaw = () => {
    if (rawMetadata) {
      navigator.clipboard.writeText(JSON.stringify(rawMetadata, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const totalPages = Math.ceil(mediaData.total / limit);

  return (
    <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
      <h1 className="page-title">{t('audit.title')}</h1>
      <p className="page-subtitle">{t('audit.subtitle')}</p>

      {/* --- TOOLBAR FILTERS --- */}
      <div className="glass-panel audit-toolbar">
        {/* Text Search */}
        <div className="audit-search-wrapper">
          <input 
            type="text" 
            className="form-input" 
            placeholder={t('audit.searchPlaceholder', { defaultValue: '🔍 Search title or filename...' })}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Library Filter */}
        <div style={{ width: '180px' }}>
          <select 
            className="form-select"
            value={selectedLibraryId}
            onChange={(e) => setSelectedLibraryId(e.target.value)}
          >
            <option value="">{t('audit.allLibraries')}</option>
            {libraries.map(lib => (
              <option key={lib.id} value={lib.id}>{lib.name}</option>
            ))}
          </select>
        </div>

        {/* Video Quality Filter */}
        <div style={{ width: '130px' }}>
          <select 
            className="form-select"
            value={videoQuality}
            onChange={(e) => setVideoQuality(e.target.value)}
          >
            <option value="">{t('audit.allQualities')}</option>
            <option value="4K">4K UltraHD</option>
            <option value="1080p">1080p FullHD</option>
            <option value="720p">720p HD</option>
            <option value="SD">{t('audit.sdStandard')}</option>
          </select>
        </div>

        {/* Failed Only Checkbox */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontFamily: 'var(--font-headings)', fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          <input 
            type="checkbox" 
            style={{ width: '16px', height: '16px', accentColor: 'var(--accent-cyan)' }}
            checked={failedOnly}
            onChange={(e) => setFailedOnly(e.target.checked)}
          />
          {t('audit.failuresOnly')}
        </label>
      </div>

      {/* --- PAGINATED GRID --- */}
      {loading && mediaData.items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px', fontFamily: 'var(--font-headings)', fontWeight: 600 }}>
          {t('audit.queryingMetadata')}
        </div>
      ) : mediaData.items.length === 0 ? (
        <div className="glass-panel" style={{ padding: '60px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          {t('audit.noMediaFiles')}
        </div>
      ) : (
        <div className="audit-grid">
          {mediaData.items.map((item) => {
            // Count failing rules
            const failingAudits = item.auditResults.filter(aud => !aud.passed);
            const isFailing = failingAudits.length > 0;
            const displayTitle = item.title || item.fileName;
            
            // Format TV structures (e.g. S01E03)
            const tvDetails = item.season !== null && item.episode !== null
              ? ` [S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}]`
              : '';

            return (
              <div 
                className={`glass-panel audit-row ${isFailing ? 'failing' : ''}`}
                key={item.id}
                onClick={() => handleRowClick(item)}
              >
                <div className="audit-row-main">
                  <div className="audit-row-title">
                    {displayTitle}{tvDetails}
                  </div>
                  <div className="audit-row-meta">
                    <span>🎬 {item.videoCodec || t('audit.unknownCodec', { defaultValue: 'Unknown Codec' })} ({item.videoResolution || 'SD'})</span>
                    <span>📂 {item.container.toUpperCase()}</span>
                    <span>💾 {formatBytes(item.fileSize)}</span>
                    {item.videoHdrFormat && <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>✨ {item.videoHdrFormat}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                    {item.audioTracks.map((track, trackIdx) => (
                      <span key={`audio-${trackIdx}`} className="badge" style={{ background: 'rgba(0, 242, 254, 0.04)', color: 'var(--accent-cyan)', border: 'var(--panel-border-active)', padding: '2px 8px', fontSize: '0.7rem' }}>
                        🔊 {track.language?.toUpperCase() || 'UND'} ({track.format})
                      </span>
                    ))}
                    {item.subtitleTracks.map((track, trackIdx) => (
                      <span key={`sub-${trackIdx}`} className="badge" style={{ background: 'rgba(155, 81, 224, 0.04)', color: 'var(--accent-amethyst)', border: '1px solid rgba(155, 81, 224, 0.25)', padding: '2px 8px', fontSize: '0.7rem' }}>
                        📝 {track.language?.toUpperCase() || 'UND'} ({track.format})
                      </span>
                    ))}
                  </div>
                </div>

                <div className="audit-row-badges">
                  {isFailing ? (
                    <span className="badge badge-failed">
                      {t('audit.failedCount', { count: failingAudits.length })}
                    </span>
                  ) : item.auditResults.length > 0 ? (
                    <span className="badge badge-passed">
                      {t('audit.compliant')}
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('audit.noAuditsRun')}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* --- PAGINATION CONTROLS --- */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', marginTop: '30px' }}>
          <button 
            className="btn btn-secondary" 
            disabled={page === 1}
            onClick={() => setPage(p => p - 1)}
          >
            {t('audit.prev')}
          </button>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
            {t('audit.page', { page, totalPages, total: mediaData.total })}
          </span>
          <button 
            className="btn btn-secondary" 
            disabled={page === totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            {t('audit.next')}
          </button>
        </div>
      )}

      {/* --- SLIDE-OVER DRAWER CARD --- */}
      {isDrawerOpen && selectedItem && (
        <>
          <div className="drawer-backdrop" onClick={() => setIsDrawerOpen(false)} />
          <div className={`drawer-content ${isDrawerOpen ? '' : 'closed'}`}>
            <div className="drawer-header">
              <div>
                <span className="badge badge-removed" style={{ marginBottom: '10px', textTransform: 'uppercase' }}>
                  {selectedItem.container.toUpperCase()} {t('audit.formatSuffix', { defaultValue: 'format' })}
                </span>
                <h2 className="drawer-title">{selectedItem.title || selectedItem.fileName}</h2>
                {selectedItem.season !== null && (
                  <span style={{ fontSize: '1rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                    {t('audit.seasonEpisode', { season: selectedItem.season, episode: selectedItem.episode })}
                  </span>
                )}
              </div>
              <button className="drawer-close-btn" onClick={() => setIsDrawerOpen(false)}>✕</button>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '15px', wordBreak: 'break-all' }}>
              {t('audit.filepath')}{selectedItem.filePath}
            </p>

            <div style={{ display: 'flex', gap: '6px', marginBottom: '30px', flexWrap: 'wrap' }}>
              {selectedItem.audioTracks.map((track, trackIdx) => (
                <span key={`drawer-audio-${trackIdx}`} className="badge" style={{ background: 'rgba(0, 242, 254, 0.04)', color: 'var(--accent-cyan)', border: 'var(--panel-border-active)', padding: '2px 8px', fontSize: '0.75rem' }}>
                  🔊 {track.language?.toUpperCase() || 'UND'} ({track.format})
                </span>
              ))}
              {selectedItem.subtitleTracks.map((track, trackIdx) => (
                <span key={`drawer-sub-${trackIdx}`} className="badge" style={{ background: 'rgba(155, 81, 224, 0.04)', color: 'var(--accent-amethyst)', border: '1px solid rgba(155, 81, 224, 0.25)', padding: '2px 8px', fontSize: '0.75rem' }}>
                  📝 {track.language?.toUpperCase() || 'UND'} ({track.format})
                </span>
              ))}
            </div>

            {/* --- ACCORDIONS LIST --- */}
            <div className="accordion">
              {/* 1. Compliance Details */}
              <div className="accordion-item">
                <div className="accordion-header" onClick={() => setActiveAccordion(activeAccordion === 'compliance' ? null : 'compliance')}>
                  <span>{t('audit.ruleAudits', { count: selectedItem.auditResults.length })}</span>
                  <span>{activeAccordion === 'compliance' ? '▼' : '▶'}</span>
                </div>
                {activeAccordion === 'compliance' && (
                  <div className="accordion-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {selectedItem.auditResults.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)' }}>{t('audit.noComplianceAudits')}</p>
                    ) : (
                      selectedItem.auditResults.map(aud => (
                        <div key={aud.ruleId} style={{ display: 'flex', gap: '10px', flexDirection: 'column', padding: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <strong style={{ fontFamily: 'var(--font-headings)' }}>{aud.ruleName}</strong>
                            <span className={aud.passed ? 'badge badge-passed' : 'badge badge-failed'} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>
                              {aud.passed ? t('audit.passed') : t('audit.failed')}
                            </span>
                          </div>
                          {!aud.passed && aud.errorMessage && (
                            <p style={{ fontSize: '0.85rem', color: 'var(--status-failed-text)', background: 'rgba(239,68,68,0.05)', padding: '8px', borderRadius: '4px', border: '1px solid rgba(239,68,68,0.1)' }}>
                              ⚠️ {aud.errorMessage}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* 2. Video Track Info */}
              <div className="accordion-item">
                <div className="accordion-header" onClick={() => setActiveAccordion(activeAccordion === 'video' ? null : 'video')}>
                  <span>{t('audit.videoMetadata')}</span>
                  <span>{activeAccordion === 'video' ? '▼' : '▶'}</span>
                </div>
                {activeAccordion === 'video' && (
                  <div className="accordion-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{t('audit.codec')}</div>
                      <div style={{ fontWeight: 600, color: '#fff' }}>{selectedItem.videoCodec || 'Unknown'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{t('audit.resolution')}</div>
                      <div style={{ fontWeight: 600, color: '#fff' }}>{selectedItem.videoResolution || 'Unknown'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{t('audit.colorDepth')}</div>
                      <div style={{ fontWeight: 600, color: '#fff' }}>{selectedItem.videoColorDepth ? `${selectedItem.videoColorDepth}-bit` : '8-bit'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{t('audit.hdrProfile')}</div>
                      <div style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>{selectedItem.videoHdrFormat || 'SDR'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{t('audit.bitrate')}</div>
                      <div style={{ fontWeight: 600, color: '#fff' }}>{selectedItem.videoBitrate ? `${Math.round(selectedItem.videoBitrate / 1000000)} Mbps` : 'N/A'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{t('audit.filesize')}</div>
                      <div style={{ fontWeight: 600, color: '#fff' }}>{formatBytes(selectedItem.fileSize)}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Audio Tracks Info */}
              <div className="accordion-item">
                <div className="accordion-header" onClick={() => setActiveAccordion(activeAccordion === 'audio' ? null : 'audio')}>
                  <span>{t('audit.audioTracks', { count: selectedItem.audioTracks.length })}</span>
                  <span>{activeAccordion === 'audio' ? '▼' : '▶'}</span>
                </div>
                {activeAccordion === 'audio' && (
                  <div className="accordion-body" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {selectedItem.audioTracks.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)' }}>{t('audit.noAudioTracks')}</p>
                    ) : (
                      selectedItem.audioTracks.map(track => (
                        <div key={track.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
                          <div>
                            <span className="badge badge-passed" style={{ padding: '2px 6px', fontSize: '0.7rem', marginRight: '8px' }}>
                              #{track.trackIndex}
                            </span>
                            <strong style={{ textTransform: 'uppercase' }}>{track.language || 'und'}</strong>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginLeft: '10px' }}>
                              {track.format} ({track.channels ? `${track.channels}ch` : 'stereo'})
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            {track.isDefault && <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>{t('audit.default')}</span>}
                            {track.isForced && <span style={{ fontSize: '0.7rem', background: 'rgba(0,242,254,0.1)', color: 'var(--accent-cyan)', padding: '2px 6px', borderRadius: '4px' }}>{t('audit.forced')}</span>}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* 4. Subtitle Tracks Info */}
              <div className="accordion-item">
                <div className="accordion-header" onClick={() => setActiveAccordion(activeAccordion === 'subtitles' ? null : 'subtitles')}>
                  <span>{t('audit.subtitleTracks', { count: selectedItem.subtitleTracks.length })}</span>
                  <span>{activeAccordion === 'subtitles' ? '▼' : '▶'}</span>
                </div>
                {activeAccordion === 'subtitles' && (
                  <div className="accordion-body" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {selectedItem.subtitleTracks.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)' }}>{t('audit.noSubtitleTracks')}</p>
                    ) : (
                      selectedItem.subtitleTracks.map(track => (
                        <div key={track.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.03)' }}>
                          <div>
                            <span className="badge badge-passed" style={{ padding: '2px 6px', fontSize: '0.7rem', marginRight: '8px' }}>
                              #{track.trackIndex}
                            </span>
                            <strong style={{ textTransform: 'uppercase' }}>{track.language || 'und'}</strong>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginLeft: '10px' }}>
                              {track.format}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            {track.isHearingImpaired && <span style={{ fontSize: '0.7rem', background: 'rgba(245,158,11,0.1)', color: 'var(--status-removed-text)', padding: '2px 6px', borderRadius: '4px' }}>{t('audit.sdh')}</span>}
                            {track.isDefault && <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>{t('audit.default')}</span>}
                            {track.isForced && <span style={{ fontSize: '0.7rem', background: 'rgba(0,242,254,0.1)', color: 'var(--accent-cyan)', padding: '2px 6px', borderRadius: '4px' }}>{t('audit.forced')}</span>}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* 5. Raw MediaInfo JSON */}
              <div className="accordion-item">
                <div className="accordion-header" onClick={() => setActiveAccordion(activeAccordion === 'raw' ? null : 'raw')}>
                  <span>{t('audit.rawMediaInfo')}</span>
                  <span>{activeAccordion === 'raw' ? '▼' : '▶'}</span>
                </div>
                {activeAccordion === 'raw' && (
                  <div className="accordion-body" style={{ padding: '10px 0 0 0', borderTop: 'none' }}>
                    {rawLoading ? (
                      <p style={{ color: 'var(--text-muted)', padding: '15px' }}>{t('audit.probingHeaders')}</p>
                    ) : rawMetadata ? (
                      <div className="code-viewer-wrapper">
                        <button className="copy-btn" onClick={handleCopyRaw}>
                          {copied ? t('audit.copied') : t('audit.copy')}
                        </button>
                        <pre style={{ color: 'var(--accent-cyan)' }}>{JSON.stringify(rawMetadata, null, 2)}</pre>
                      </div>
                    ) : (
                      <p style={{ color: 'var(--status-failed-text)', padding: '15px' }}>{t('audit.failedHeaders')}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
