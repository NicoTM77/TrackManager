import logger from '../utils/logger';

export interface RuleCondition {
  field: string;
  operator: string;
  value?: any;
  params?: {
    language?: string | string[];
    format?: string | string[];
    channels?: any;
    isForced?: boolean;
    isHearingImpaired?: boolean;
    isDefault?: boolean;
  };
}

export interface RuleAST {
  logicalOperator: 'AND' | 'OR';
  conditions: RuleCondition[];
}

export interface EvaluationResult {
  passed: boolean;
  errorMessage?: string;
}

/**
 * Normalizes ISO language codes to 3-letter ISO 639-2 codes where possible.
 */
export function normalizeLanguage(lang: string | null | undefined): string {
  if (!lang) return 'und';
  const clean = lang.trim().toLowerCase();
  
  if (clean === 'en' || clean === 'english') return 'eng';
  if (clean === 'de' || clean === 'ger' || clean === 'deu' || clean === 'deutsch' || clean === 'german') return 'ger';
  if (clean === 'fr' || clean === 'fre' || clean === 'fra' || clean === 'french') return 'fre';
  if (clean === 'es' || clean === 'spa' || clean === 'spanish' || clean === 'espanol') return 'spa';
  if (clean === 'it' || clean === 'ita' || clean === 'italian') return 'ita';
  if (clean === 'ja' || clean === 'jpn' || clean === 'jap' || clean === 'japanese') return 'jpn';
  if (clean === 'zh' || clean === 'chi' || clean === 'zho' || clean === 'chinese') return 'chi';
  if (clean === 'ru' || clean === 'rus' || clean === 'russian') return 'rus';
  if (clean === 'nl' || clean === 'dut' || clean === 'nld' || clean === 'dutch') return 'dut';
  if (clean === 'pt' || clean === 'por' || clean === 'portuguese') return 'por';
  if (clean === 'sv' || clean === 'swe' || clean === 'swedish') return 'swe';
  if (clean === 'da' || clean === 'dan' || clean === 'danish') return 'dan';
  if (clean === 'no' || clean === 'nor' || clean === 'norwegian') return 'nor';
  if (clean === 'fi' || clean === 'fin' || clean === 'finnish') return 'fin';
  if (clean === 'pl' || clean === 'pol' || clean === 'polish') return 'pol';
  if (clean === 'ko' || clean === 'kor' || clean === 'korean') return 'kor';
  
  if (clean.length === 3) return clean;
  return clean.substring(0, 3);
}

/**
 * Evaluates a single rule condition against a Media Item and its associated tracks.
 */
export function evaluateCondition(condition: RuleCondition, item: any): EvaluationResult {
  const field = condition.field;
  const operator = condition.operator;
  const val = condition.value;

  // 1. Direct Media Properties
  if (['container', 'videoResolution', 'videoCodec', 'videoColorDepth', 'videoHdrFormat'].includes(field)) {
    const itemVal = item[field];
    
    if (itemVal === null || itemVal === undefined) {
      if (operator === 'EQUALS') {
        const passed = val === null || val === undefined;
        return {
          passed,
          errorMessage: passed ? undefined : `Field "${field}" is missing from media metadata.`
        };
      }
      return { passed: false, errorMessage: `Field "${field}" is missing from media metadata.` };
    }

    const strItemVal = String(itemVal).toLowerCase();
    
    switch (operator) {
      case 'EQUALS': {
        const strVal = String(val).toLowerCase();
        const passed = strItemVal === strVal;
        return {
          passed,
          errorMessage: passed ? undefined : `Field "${field}" is "${itemVal}", expected "${val}".`
        };
      }
      case 'NOT_EQUALS': {
        const strVal = String(val).toLowerCase();
        const passed = strItemVal !== strVal;
        return {
          passed,
          errorMessage: passed ? undefined : `Field "${field}" is "${itemVal}", which must not be "${val}".`
        };
      }
      case 'CONTAINS': {
        const strVal = String(val).toLowerCase();
        const passed = strItemVal.includes(strVal);
        return {
          passed,
          errorMessage: passed ? undefined : `Field "${field}" is "${itemVal}", which does not contain "${val}".`
        };
      }
      case 'NOT_CONTAINS': {
        const strVal = String(val).toLowerCase();
        const passed = !strItemVal.includes(strVal);
        return {
          passed,
          errorMessage: passed ? undefined : `Field "${field}" is "${itemVal}", which must not contain "${val}".`
        };
      }
      case 'IN': {
        const arr = Array.isArray(val) ? val : [val];
        const normalizedArr = arr.map(v => String(v).toLowerCase());
        const passed = normalizedArr.includes(strItemVal);
        return {
          passed,
          errorMessage: passed ? undefined : `Field "${field}" is "${itemVal}", which is not in list: [${arr.join(', ')}].`
        };
      }
      case 'NOT_IN': {
        const arr = Array.isArray(val) ? val : [val];
        const normalizedArr = arr.map(v => String(v).toLowerCase());
        const passed = !normalizedArr.includes(strItemVal);
        return {
          passed,
          errorMessage: passed ? undefined : `Field "${field}" is "${itemVal}", which must not be in list: [${arr.join(', ')}].`
        };
      }
      case 'GTE': {
        const numItem = Number(itemVal);
        const numRule = Number(val);
        const passed = !isNaN(numItem) && !isNaN(numRule) && numItem >= numRule;
        return {
          passed,
          errorMessage: passed ? undefined : `Field "${field}" is ${itemVal}, which is less than expected ${val}.`
        };
      }
      case 'LTE': {
        const numItem = Number(itemVal);
        const numRule = Number(val);
        const passed = !isNaN(numItem) && !isNaN(numRule) && numItem <= numRule;
        return {
          passed,
          errorMessage: passed ? undefined : `Field "${field}" is ${itemVal}, which is greater than expected ${val}.`
        };
      }
      default:
        return { passed: false, errorMessage: `Unsupported operator "${operator}" on field "${field}".` };
    }
  }

  // 2. Audio track sub-auditing
  if (field === 'audio') {
    if (operator !== 'HAS_AUDIO') {
      return { passed: false, errorMessage: `Unsupported operator "${operator}" on field "audio".` };
    }

    const params = condition.params || {};
    const tracks = item.audioTracks || [];
    
    if (tracks.length === 0) {
      return { passed: false, errorMessage: 'No audio tracks found in media file.' };
    }

    // Check if any track meets ALL parameter criteria
    const matchingTrack = tracks.find((track: any) => {
      // a. Language matching
      if (params.language) {
        const trackLang = normalizeLanguage(track.language);
        if (Array.isArray(params.language)) {
          const ruleLangs = params.language.map(l => normalizeLanguage(l));
          if (!ruleLangs.includes(trackLang)) return false;
        } else {
          const ruleLang = normalizeLanguage(params.language);
          if (trackLang !== ruleLang) return false;
        }
      }

      // b. Format matching (case-insensitive substring check)
      if (params.format) {
        const trackFormat = String(track.format).toLowerCase();
        if (Array.isArray(params.format)) {
          const formats = params.format.map(f => String(f).toLowerCase());
          const formatMatched = formats.some(f => trackFormat.includes(f));
          if (!formatMatched) return false;
        } else {
          const format = String(params.format).toLowerCase();
          if (!trackFormat.includes(format)) return false;
        }
      }

      // c. Channels comparison
      if (params.channels !== undefined) {
        const trackChannels = track.channels;
        if (trackChannels === null || trackChannels === undefined) return false;
        
        if (typeof params.channels === 'number') {
          if (trackChannels !== params.channels) return false;
        } else if (typeof params.channels === 'string') {
          const clean = params.channels.trim().toUpperCase();
          const match = clean.match(/^(GTE|LTE|EQUALS|>=|<=|=)?\s*(\d+)$/);
          if (match) {
            const op = match[1] || 'EQUALS';
            const valNum = parseInt(match[2], 10);
            if ((op === 'GTE' || op === '>=') && trackChannels < valNum) return false;
            if ((op === 'LTE' || op === '<=') && trackChannels > valNum) return false;
            if (op === 'EQUALS' && trackChannels !== valNum) return false;
          }
        } else if (typeof params.channels === 'object' && params.channels !== null) {
          const op = String(params.channels.operator).toUpperCase();
          const valNum = Number(params.channels.value);
          if (!isNaN(valNum)) {
            if ((op === 'GTE' || op === '>=') && trackChannels < valNum) return false;
            if ((op === 'LTE' || op === '<=') && trackChannels > valNum) return false;
            if (op === 'EQUALS' && trackChannels !== valNum) return false;
          }
        }
      }

      // d. Default track
      if (params.isDefault !== undefined && track.isDefault !== params.isDefault) {
        return false;
      }

      // e. Forced track
      if (params.isForced !== undefined && track.isForced !== params.isForced) {
        return false;
      }

      return true;
    });

    if (matchingTrack) {
      return { passed: true };
    }

    // Build helpful validation message if no tracks match
    const langDesc = params.language
      ? `language "${Array.isArray(params.language) ? params.language.join('/') : params.language}"`
      : 'any language';
    const formatDesc = params.format
      ? `format "${Array.isArray(params.format) ? params.format.join('/') : params.format}"`
      : 'any format';
    const chanDesc = params.channels !== undefined
      ? `channels matching "${typeof params.channels === 'object' ? JSON.stringify(params.channels) : params.channels}"`
      : '';
    const details = [langDesc, formatDesc, chanDesc].filter(d => d !== '').join(', ');

    return {
      passed: false,
      errorMessage: `Missing Audio track with: ${details}.`
    };
  }

  // 3. Subtitle track sub-auditing
  if (field === 'subtitles') {
    if (operator !== 'HAS_SUBTITLE') {
      return { passed: false, errorMessage: `Unsupported operator "${operator}" on field "subtitles".` };
    }

    const params = condition.params || {};
    const tracks = item.subtitleTracks || [];

    const matchingTrack = tracks.find((track: any) => {
      // a. Language matching
      if (params.language) {
        const trackLang = normalizeLanguage(track.language);
        if (Array.isArray(params.language)) {
          const ruleLangs = params.language.map(l => normalizeLanguage(l));
          if (!ruleLangs.includes(trackLang)) return false;
        } else {
          const ruleLang = normalizeLanguage(params.language);
          if (trackLang !== ruleLang) return false;
        }
      }

      // b. Format matching (case-insensitive substring check)
      if (params.format) {
        const trackFormat = String(track.format).toLowerCase();
        if (Array.isArray(params.format)) {
          const formats = params.format.map(f => String(f).toLowerCase());
          const formatMatched = formats.some(f => trackFormat.includes(f));
          if (!formatMatched) return false;
        } else {
          const format = String(params.format).toLowerCase();
          if (!trackFormat.includes(format)) return false;
        }
      }

      // c. Forced track matching
      if (params.isForced !== undefined && track.isForced !== params.isForced) {
        return false;
      }

      // d. Hearing Impaired matching (SDH)
      if (params.isHearingImpaired !== undefined && track.isHearingImpaired !== params.isHearingImpaired) {
        return false;
      }

      // e. Default track matching
      if (params.isDefault !== undefined && track.isDefault !== params.isDefault) {
        return false;
      }

      return true;
    });

    if (matchingTrack) {
      return { passed: true };
    }

    // Build helpful validation message if no subtitle matches
    const langDesc = params.language
      ? `language "${Array.isArray(params.language) ? params.language.join('/') : params.language}"`
      : 'any language';
    const formatDesc = params.format
      ? `format "${Array.isArray(params.format) ? params.format.join('/') : params.format}"`
      : 'any format';
    const forcedDesc = params.isForced !== undefined ? `isForced: ${params.isForced}` : '';
    const sdhDesc = params.isHearingImpaired !== undefined ? `isHearingImpaired: ${params.isHearingImpaired}` : '';
    const details = [langDesc, formatDesc, forcedDesc, sdhDesc].filter(d => d !== '').join(', ');

    return {
      passed: false,
      errorMessage: `Missing Subtitle track with: ${details}.`
    };
  }

  return { passed: false, errorMessage: `Unknown evaluation field "${field}".` };
}

/**
 * Main entry point: Evaluates a full Rule conditions JSON AST against a MediaItem and its tracks.
 * 
 * @param ruleConditionsJson The parsed/unparsed JSON AST block for the rule.
 * @param item The MediaItem (including audioTracks and subtitleTracks lists).
 * @returns EvaluationResult representing overall compliance.
 */
export function evaluateRule(ruleConditionsJson: string | object, item: any): EvaluationResult {
  let ast: RuleAST;

  try {
    if (typeof ruleConditionsJson === 'string') {
      ast = JSON.parse(ruleConditionsJson);
    } else {
      ast = ruleConditionsJson as RuleAST;
    }
  } catch (error) {
    logger.error(error, 'Failed to parse rule conditions AST JSON.');
    return { passed: false, errorMessage: 'Invalid rule conditions format (invalid JSON AST).' };
  }

  if (!ast || !ast.conditions || !Array.isArray(ast.conditions) || ast.conditions.length === 0) {
    return { passed: true }; // Rule has no conditions, vacuously passed
  }

  const logicalOp = ast.logicalOperator || 'AND';
  const results = ast.conditions.map(cond => evaluateCondition(cond, item));

  if (logicalOp === 'AND') {
    const failedResult = results.find(res => !res.passed);
    if (failedResult) {
      return {
        passed: false,
        errorMessage: failedResult.errorMessage
      };
    }
    return { passed: true };
  } else {
    // OR operator: At least one must pass
    const passedResult = results.find(res => res.passed);
    if (passedResult) {
      return { passed: true };
    }
    
    // If all failed, concatenate the failure messages to explain why
    const errors = results.map((res, i) => `Option ${i + 1}: [${res.errorMessage}]`).join(' OR ');
    return {
      passed: false,
      errorMessage: `All alternatives failed compliance check: ${errors}`
    };
  }
}
