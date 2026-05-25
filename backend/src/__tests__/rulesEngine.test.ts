import { describe, it, expect } from 'vitest';
import { evaluateRule, normalizeLanguage, evaluateCondition } from '../services/rulesEngine';

describe('Rules Engine - Language Code Normalizer', () => {
  it('should correctly map variations to 3-letter ISO-639-2 codes', () => {
    expect(normalizeLanguage('english')).toBe('eng');
    expect(normalizeLanguage('en')).toBe('eng');
    expect(normalizeLanguage('ENG')).toBe('eng');

    expect(normalizeLanguage('german')).toBe('ger');
    expect(normalizeLanguage('deutsch')).toBe('ger');
    expect(normalizeLanguage('deu')).toBe('ger');
    expect(normalizeLanguage('de')).toBe('ger');

    expect(normalizeLanguage('french')).toBe('fre');
    expect(normalizeLanguage('fr')).toBe('fre');

    expect(normalizeLanguage('ja')).toBe('jpn');
    expect(normalizeLanguage('japanese')).toBe('jpn');
    expect(normalizeLanguage('jpn')).toBe('jpn');

    expect(normalizeLanguage(null)).toBe('und');
    expect(normalizeLanguage(undefined)).toBe('und');
    expect(normalizeLanguage('und')).toBe('und');
  });

  it('should fall back to 3-character prefixes for unknown long language names', () => {
    expect(normalizeLanguage('klingon')).toBe('kli');
    expect(normalizeLanguage('elvish')).toBe('elv');
  });
});

describe('Rules Engine - Simple Field Audits', () => {
  const mockItem = {
    container: 'mkv',
    videoResolution: '3840x2160',
    videoCodec: 'HEVC',
    videoColorDepth: 10,
    videoHdrFormat: 'Dolby Vision',
  };

  it('should evaluate EQUALS and CONTAINS operators correctly', () => {
    // container EQUALS mkv -> true
    expect(evaluateCondition({ field: 'container', operator: 'EQUALS', value: 'mkv' }, mockItem).passed).toBe(true);
    // container EQUALS mp4 -> false
    const res1 = evaluateCondition({ field: 'container', operator: 'EQUALS', value: 'mp4' }, mockItem);
    expect(res1.passed).toBe(false);
    expect(res1.errorMessage).toBe('Field "container" is "mkv", expected "mp4".');

    // videoHdrFormat CONTAINS Dolby -> true
    expect(evaluateCondition({ field: 'videoHdrFormat', operator: 'CONTAINS', value: 'Dolby' }, mockItem).passed).toBe(true);
    // videoHdrFormat CONTAINS HDR10 -> false
    const res2 = evaluateCondition({ field: 'videoHdrFormat', operator: 'CONTAINS', value: 'HDR10' }, mockItem);
    expect(res2.passed).toBe(false);
    expect(res2.errorMessage).toBe('Field "videoHdrFormat" is "Dolby Vision", which does not contain "HDR10".');
  });

  it('should evaluate IN, GTE, and LTE operators correctly', () => {
    // container IN [mkv, mp4] -> true
    expect(evaluateCondition({ field: 'container', operator: 'IN', value: ['mkv', 'mp4'] }, mockItem).passed).toBe(true);
    // container IN [mp4, avi] -> false
    expect(evaluateCondition({ field: 'container', operator: 'IN', value: ['mp4', 'avi'] }, mockItem).passed).toBe(false);

    // videoColorDepth GTE 10 -> true
    expect(evaluateCondition({ field: 'videoColorDepth', operator: 'GTE', value: 10 }, mockItem).passed).toBe(true);
    // videoColorDepth GTE 12 -> false
    expect(evaluateCondition({ field: 'videoColorDepth', operator: 'GTE', value: 12 }, mockItem).passed).toBe(false);

    // videoColorDepth LTE 10 -> true
    expect(evaluateCondition({ field: 'videoColorDepth', operator: 'LTE', value: 10 }, mockItem).passed).toBe(true);
    // videoColorDepth LTE 8 -> false
    expect(evaluateCondition({ field: 'videoColorDepth', operator: 'LTE', value: 8 }, mockItem).passed).toBe(false);
  });

  it('should evaluate NOT_EQUALS, NOT_CONTAINS, and NOT_IN operators correctly', () => {
    // videoCodec NOT_EQUALS HEVC -> false
    const res1 = evaluateCondition({ field: 'videoCodec', operator: 'NOT_EQUALS', value: 'HEVC' }, mockItem);
    expect(res1.passed).toBe(false);
    expect(res1.errorMessage).toBe('Field "videoCodec" is "HEVC", which must not be "HEVC".');

    // videoCodec NOT_EQUALS AVC -> true
    expect(evaluateCondition({ field: 'videoCodec', operator: 'NOT_EQUALS', value: 'AVC' }, mockItem).passed).toBe(true);

    // videoHdrFormat NOT_CONTAINS Dolby -> false
    const res2 = evaluateCondition({ field: 'videoHdrFormat', operator: 'NOT_CONTAINS', value: 'Dolby' }, mockItem);
    expect(res2.passed).toBe(false);
    expect(res2.errorMessage).toBe('Field "videoHdrFormat" is "Dolby Vision", which must not contain "Dolby".');

    // videoHdrFormat NOT_CONTAINS HDR10 -> true
    expect(evaluateCondition({ field: 'videoHdrFormat', operator: 'NOT_CONTAINS', value: 'HDR10' }, mockItem).passed).toBe(true);

    // container NOT_IN [mkv, mp4] -> false
    const res3 = evaluateCondition({ field: 'container', operator: 'NOT_IN', value: ['mkv', 'mp4'] }, mockItem);
    expect(res3.passed).toBe(false);
    expect(res3.errorMessage).toBe('Field "container" is "mkv", which must not be in list: [mkv, mp4].');

    // container NOT_IN [mp4, avi] -> true
    expect(evaluateCondition({ field: 'container', operator: 'NOT_IN', value: ['mp4', 'avi'] }, mockItem).passed).toBe(true);
  });
});

describe('Rules Engine - Audio Track Audits', () => {
  const mockItem = {
    audioTracks: [
      {
        language: 'ger',
        format: 'DTS-HD Master Audio',
        channels: 6,
        isDefault: false,
        isForced: false,
      },
      {
        language: 'eng',
        format: 'TrueHD (Atmos)',
        channels: 8,
        isDefault: true,
        isForced: false,
      }
    ]
  };

  it('should match audio tracks by language and format', () => {
    // GER audio track exists
    expect(evaluateCondition({
      field: 'audio',
      operator: 'HAS_AUDIO',
      params: { language: 'ger' }
    }, mockItem).passed).toBe(true);

    // ENG audio in TrueHD format exists
    expect(evaluateCondition({
      field: 'audio',
      operator: 'HAS_AUDIO',
      params: { language: 'eng', format: 'TrueHD' }
    }, mockItem).passed).toBe(true);

    // FRE audio does not exist
    const res = evaluateCondition({
      field: 'audio',
      operator: 'HAS_AUDIO',
      params: { language: 'fre' }
    }, mockItem);
    expect(res.passed).toBe(false);
    expect(res.errorMessage).toContain('Missing Audio track with: language "fre"');
  });

  it('should audit track channels with various formats (number, string, operator object)', () => {
    // Match exact channels as number
    expect(evaluateCondition({
      field: 'audio',
      operator: 'HAS_AUDIO',
      params: { channels: 8 }
    }, mockItem).passed).toBe(true);

    // Match channels GTE 6
    expect(evaluateCondition({
      field: 'audio',
      operator: 'HAS_AUDIO',
      params: { channels: 'GTE 6' }
    }, mockItem).passed).toBe(true);

    // Match channels using comparison object
    expect(evaluateCondition({
      field: 'audio',
      operator: 'HAS_AUDIO',
      params: { channels: { operator: 'GTE', value: 8 } }
    }, mockItem).passed).toBe(true);

    // Channels GTE 10 does not exist
    expect(evaluateCondition({
      field: 'audio',
      operator: 'HAS_AUDIO',
      params: { channels: 'GTE 10' }
    }, mockItem).passed).toBe(false);
  });
});

describe('Rules Engine - Subtitle Track Audits', () => {
  const mockItem = {
    subtitleTracks: [
      {
        language: 'eng',
        format: 'SRT',
        isDefault: true,
        isForced: false,
        isHearingImpaired: true,
      },
      {
        language: 'ger',
        format: 'PGS',
        isDefault: false,
        isForced: true,
        isHearingImpaired: false,
      }
    ]
  };

  it('should audit subtitle tracks by format, forced, and SDH states', () => {
    // English SRT subtitles exist
    expect(evaluateCondition({
      field: 'subtitles',
      operator: 'HAS_SUBTITLE',
      params: { language: 'eng', format: 'SRT' }
    }, mockItem).passed).toBe(true);

    // German forced subtitles exist
    expect(evaluateCondition({
      field: 'subtitles',
      operator: 'HAS_SUBTITLE',
      params: { language: 'ger', isForced: true }
    }, mockItem).passed).toBe(true);

    // English SDH subtitles exist
    expect(evaluateCondition({
      field: 'subtitles',
      operator: 'HAS_SUBTITLE',
      params: { language: 'eng', isHearingImpaired: true }
    }, mockItem).passed).toBe(true);

    // French subtitles do not exist
    const res = evaluateCondition({
      field: 'subtitles',
      operator: 'HAS_SUBTITLE',
      params: { language: 'fre' }
    }, mockItem);
    expect(res.passed).toBe(false);
    expect(res.errorMessage).toContain('Missing Subtitle track with: language "fre"');
  });
});

describe('Rules Engine - Full AST Logical Evaluator', () => {
  const mockItem = {
    container: 'mkv',
    videoResolution: '3840x2160',
    videoCodec: 'HEVC',
    videoColorDepth: 10,
    videoHdrFormat: 'Dolby Vision',
    audioTracks: [
      { language: 'eng', format: 'TrueHD', channels: 8, isDefault: true, isForced: false }
    ],
    subtitleTracks: [
      { language: 'eng', format: 'SRT', isDefault: false, isForced: false, isHearingImpaired: true }
    ]
  };

  it('should successfully evaluate AND rules', () => {
    const andRule = {
      logicalOperator: 'AND' as const,
      conditions: [
        { field: 'container', operator: 'EQUALS', value: 'mkv' },
        { field: 'videoColorDepth', operator: 'GTE', value: 10 },
        { field: 'audio', operator: 'HAS_AUDIO', params: { language: 'eng', format: 'TrueHD' } }
      ]
    };

    expect(evaluateRule(andRule, mockItem).passed).toBe(true);
  });

  it('should report the first failing condition when an AND rule fails', () => {
    const failingAndRule = {
      logicalOperator: 'AND' as const,
      conditions: [
        { field: 'container', operator: 'EQUALS', value: 'mkv' },
        { field: 'videoColorDepth', operator: 'GTE', value: 12 }, // Fails!
        { field: 'audio', operator: 'HAS_AUDIO', params: { language: 'ger' } } // Fails too!
      ]
    };

    const res = evaluateRule(failingAndRule, mockItem);
    expect(res.passed).toBe(false);
    expect(res.errorMessage).toBe('Field "videoColorDepth" is 10, which is less than expected 12.');
  });

  it('should successfully evaluate OR rules', () => {
    const orRule = {
      logicalOperator: 'OR' as const,
      conditions: [
        { field: 'container', operator: 'EQUALS', value: 'mp4' }, // Fails
        { field: 'videoColorDepth', operator: 'GTE', value: 12 }, // Fails
        { field: 'videoHdrFormat', operator: 'CONTAINS', value: 'Vision' } // Passes!
      ]
    };

    expect(evaluateRule(orRule, mockItem).passed).toBe(true);
  });

  it('should report consolidated options list when an OR rule fails completely', () => {
    const failingOrRule = {
      logicalOperator: 'OR' as const,
      conditions: [
        { field: 'container', operator: 'EQUALS', value: 'mp4' },
        { field: 'videoColorDepth', operator: 'GTE', value: 12 }
      ]
    };

    const res = evaluateRule(failingOrRule, mockItem);
    expect(res.passed).toBe(false);
    expect(res.errorMessage).toBe(
      'All alternatives failed compliance check: Option 1: [Field "container" is "mkv", expected "mp4".] OR Option 2: [Field "videoColorDepth" is 10, which is less than expected 12.]'
    );
  });
});
