import React, { useState, useEffect } from 'react';

interface Rule {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  targetType: string;
  conditions: {
    logicalOperator: 'AND' | 'OR';
    conditions: any[];
  };
}

interface MediaItemSimple {
  id: number;
  title: string | null;
  fileName: string;
}

interface RulesBuilderProps {
  apiBase: string;
}

const parseChannelsValue = (channels: any): string | number => {
  if (channels === undefined || channels === null) return '';
  if (typeof channels === 'number') return channels;
  if (typeof channels === 'string') {
    const match = channels.match(/\d+/);
    return match ? parseInt(match[0], 10) : '';
  }
  if (typeof channels === 'object' && channels !== null) {
    return channels.value !== undefined ? channels.value : '';
  }
  return '';
};

export const RulesBuilder: React.FC<RulesBuilderProps> = ({ apiBase }) => {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);

  // New/Edit Rule Form States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [ruleDesc, setRuleDesc] = useState('');
  const [targetType, setTargetType] = useState<string>('movie,tv,anime');
  const [logicalOp, setLogicalOp] = useState<'AND' | 'OR'>('AND');
  const [formConditions, setFormConditions] = useState<any[]>([
    { field: 'videoCodec', operator: 'EQUALS', value: 'HEVC' }
  ]);
  const [formError, setFormError] = useState('');

  // Mode Switch inside Modal: 'visual' Builder vs 'code' JSON editor
  const [editorMode, setEditorMode] = useState<'visual' | 'code'>('visual');
  const [codeString, setCodeString] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Simulator States
  const [testFiles, setTestFiles] = useState<MediaItemSimple[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string>('');
  const [simAstString, setSimAstString] = useState(
    JSON.stringify({
      logicalOperator: "AND",
      conditions: [
        {
          field: "subtitles",
          operator: "HAS_SUBTITLE",
          params: { language: "eng", format: ["SRT", "ASS"] }
        }
      ]
    }, null, 2)
  );
  const [simResult, setSimResult] = useState<{ passed: boolean; errorMessage?: string } | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  const fetchRulesAndFiles = async () => {
    try {
      const [rulesRes, mediaRes] = await Promise.all([
        fetch(`${apiBase}/api/rules`),
        fetch(`${apiBase}/api/media?limit=10`) // get first 10 files for easy testing
      ]);
      
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setRules(data);
      }

      if (mediaRes.ok) {
        const data = await mediaRes.json();
        setTestFiles(data.items.map((i: any) => ({
          id: i.id,
          title: i.title,
          fileName: i.fileName
        })));
        if (data.items.length > 0 && !selectedFileId) {
          setSelectedFileId(String(data.items[0].id));
        }
      }
    } catch (err) {
      console.error('Failed to load rules builder assets:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRulesAndFiles();
  }, [apiBase]);

  const handleAddCondition = () => {
    setFormConditions(prev => [...prev, { field: 'videoCodec', operator: 'EQUALS', value: '' }]);
  };

  const handleRemoveCondition = (index: number) => {
    setFormConditions(prev => prev.filter((_, i) => i !== index));
  };

  const handleConditionChange = (index: number, fieldName: string, val: any) => {
    setFormConditions(prev => prev.map((cond, i) => {
      if (i !== index) return cond;
      
      const newCond = { ...cond, [fieldName]: val };
      
      // Auto-set standard params if switching fields
      if (fieldName === 'field') {
        if (val === 'audio') {
          newCond.operator = 'HAS_AUDIO';
          delete newCond.value;
          newCond.params = { language: 'eng', format: ['TrueHD'], channels: '>= 6' };
        } else if (val === 'subtitles') {
          newCond.operator = 'HAS_SUBTITLE';
          delete newCond.value;
          newCond.params = { language: 'eng', format: ['SRT'], isForced: false, isHearingImpaired: false };
        } else {
          newCond.operator = 'EQUALS';
          newCond.value = '';
          delete newCond.params;
        }
      }
      return newCond;
    }));
  };

  const handleParamChange = (index: number, paramKey: string, val: any) => {
    setFormConditions(prev => prev.map((cond, i) => {
      if (i !== index) return cond;
      const currentParams = cond.params || {};
      return {
        ...cond,
        params: {
          ...currentParams,
          [paramKey]: val
        }
      };
    }));
  };

  const handleCodeChange = (val: string) => {
    setCodeString(val);
    setValidationError(null);
    try {
      const parsed = JSON.parse(val);
      if (!parsed || typeof parsed !== 'object') {
        setValidationError('AST must be a valid JSON object.');
        return;
      }
      if (parsed.logicalOperator !== 'AND' && parsed.logicalOperator !== 'OR') {
        setValidationError('AST root must contain "logicalOperator" set to "AND" or "OR".');
        return;
      }
      if (!Array.isArray(parsed.conditions)) {
        setValidationError('AST root must contain a "conditions" array.');
        return;
      }
      
      for (const cond of parsed.conditions) {
        if (!cond.field) {
          setValidationError('Every condition clause must specify a "field" property.');
          return;
        }
        const validFields = ['videoCodec', 'videoResolution', 'videoColorDepth', 'videoHdrFormat', 'container', 'audio', 'subtitles'];
        if (!validFields.includes(cond.field)) {
          setValidationError(`Invalid condition field: "${cond.field}". Must be one of: ${validFields.join(', ')}.`);
          return;
        }
        if (cond.field === 'audio' || cond.field === 'subtitles') {
          if (cond.operator !== 'HAS_AUDIO' && cond.operator !== 'HAS_SUBTITLE') {
            setValidationError(`Invalid operator for field "${cond.field}". Audio/Subtitles require HAS_AUDIO or HAS_SUBTITLE operators.`);
            return;
          }
        } else {
          const validOperators = ['EQUALS', 'CONTAINS', 'IN', 'GTE', 'LTE'];
          if (!cond.operator || !validOperators.includes(cond.operator)) {
            setValidationError(`Invalid operator "${cond.operator}" for field "${cond.field}". Must be one of: ${validOperators.join(', ')}.`);
            return;
          }
        }
      }
      
      // Sync parameters to let visual builder capture JSON code edits in real-time
      setLogicalOp(parsed.logicalOperator);
      setFormConditions(parsed.conditions);
    } catch (err: any) {
      setValidationError(`JSON Syntax Error: ${err.message || err}`);
    }
  };

  const handleToggleActive = async (rule: Rule) => {
    try {
      const res = await fetch(`${apiBase}/api/rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: rule.name,
          description: rule.description,
          isActive: !rule.isActive,
          targetType: rule.targetType,
          conditions: rule.conditions
        })
      });
      if (res.ok) {
        fetchRulesAndFiles();
      }
    } catch (err) {
      console.error('Failed to toggle rule active state:', err);
    }
  };

  const handleCheckboxChange = (category: 'movie' | 'tv' | 'anime', checked: boolean) => {
    let active = targetType.split(',').map(s => s.trim().toLowerCase()).filter(s => s && s !== 'all');
    if (checked) {
      if (!active.includes(category)) {
        active.push(category);
      }
    } else {
      active = active.filter(item => item !== category);
    }
    
    if (active.length === 3) {
      setTargetType('movie,tv,anime');
    } else {
      setTargetType(active.join(','));
    }
  };

  const handleSelectAll = (e: React.MouseEvent) => {
    e.preventDefault();
    setTargetType('movie,tv,anime');
  };

  const handleStartCreate = () => {
    setEditingRuleId(null);
    setRuleName('');
    setRuleDesc('');
    setTargetType('movie,tv,anime');
    setLogicalOp('AND');
    const initialConditions = [{ field: 'videoCodec', operator: 'EQUALS', value: 'HEVC' }];
    setFormConditions(initialConditions);
    setEditorMode('visual');
    setCodeString(JSON.stringify({ logicalOperator: 'AND', conditions: initialConditions }, null, 2));
    setValidationError(null);
    setIsModalOpen(true);
  };

  const handleStartEdit = (rule: Rule) => {
    setEditingRuleId(rule.id);
    setRuleName(rule.name);
    setRuleDesc(rule.description || '');
    setTargetType(rule.targetType === 'all' ? 'movie,tv,anime' : rule.targetType);
    
    const isStandardObj = rule.conditions && typeof rule.conditions === 'object' && !Array.isArray(rule.conditions);
    const op = isStandardObj ? rule.conditions.logicalOperator || 'AND' : 'AND';
    const conds = isStandardObj ? rule.conditions.conditions || [] : (Array.isArray(rule.conditions) ? rule.conditions : []);

    setLogicalOp(op);
    const copiedConditions = JSON.parse(JSON.stringify(conds));
    setFormConditions(copiedConditions);
    setEditorMode('visual');
    setCodeString(JSON.stringify(isStandardObj ? rule.conditions : { logicalOperator: op, conditions: conds }, null, 2));
    setValidationError(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingRuleId(null);
    setRuleName('');
    setRuleDesc('');
    setTargetType('movie,tv,anime');
    setLogicalOp('AND');
    setFormConditions([{ field: 'videoCodec', operator: 'EQUALS', value: 'HEVC' }]);
    setEditorMode('visual');
    setCodeString('');
    setValidationError(null);
    setFormError('');
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (editorMode === 'code' && validationError) {
      setFormError('Please resolve all JSON syntax validation errors before saving.');
      return;
    }

    if (!ruleName) {
      setFormError('Rule name is required.');
      return;
    }
    if (!targetType || targetType.trim() === '') {
      setFormError('Please check at least one target option (Movies, TV Shows, or Anime).');
      return;
    }
    if (formConditions.length === 0) {
      setFormError('Please add at least one condition clause.');
      return;
    }

    // Simple validation
    for (const cond of formConditions) {
      if (cond.field !== 'audio' && cond.field !== 'subtitles' && !cond.value) {
        setFormError(`Please specify value for condition on "${cond.field}".`);
        return;
      }
    }

    const isEditing = editingRuleId !== null;
    const url = isEditing ? `${apiBase}/api/rules/${editingRuleId}` : `${apiBase}/api/rules`;
    const method = isEditing ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ruleName,
          description: ruleDesc,
          isActive: true,
          targetType,
          conditions: {
            logicalOperator: logicalOp,
            conditions: formConditions
          }
        })
      });

      if (res.ok) {
        handleCloseModal();
        fetchRulesAndFiles();
      } else {
        const err = await res.json();
        setFormError(err.error || `Failed to ${isEditing ? 'update' : 'create'} rule.`);
      }
    } catch (err) {
      setFormError('Network error occurred.');
    }
  };

  const handleDeleteRule = async (id: number) => {
    if (!confirm('Are you sure you want to delete this compliance rule?')) return;
    try {
      const res = await fetch(`${apiBase}/api/rules/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchRulesAndFiles();
      }
    } catch (err) {
      console.error('Failed to delete rule:', err);
    }
  };

  const handleCopyToSandbox = (rule: Rule) => {
    const isStandardObj = rule.conditions && typeof rule.conditions === 'object' && !Array.isArray(rule.conditions);
    const op = isStandardObj ? rule.conditions.logicalOperator || 'AND' : 'AND';
    const conds = isStandardObj ? rule.conditions.conditions || [] : (Array.isArray(rule.conditions) ? rule.conditions : []);
    
    const normalizedConditions = isStandardObj ? rule.conditions : { logicalOperator: op, conditions: conds };
    setSimAstString(JSON.stringify(normalizedConditions, null, 2));
    const simulatorElement = document.getElementById('compliance-simulator-pane');
    if (simulatorElement) {
      simulatorElement.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleSaveSimulatorRule = () => {
    try {
      const parsed = JSON.parse(simAstString);
      if (!parsed || typeof parsed !== 'object') {
        alert('Invalid simulated AST structure. Ensure it is a valid JSON object.');
        return;
      }
      const simConditions = parsed.conditions || [];
      const simOp = parsed.logicalOperator || 'AND';
      
      setFormConditions(simConditions);
      setLogicalOp(simOp);
      setRuleName('Simulated Compliance Rule');
      setRuleDesc('Saved from sandbox compliance simulation');
      setTargetType('movie,tv,anime');
      setEditingRuleId(null);
      setEditorMode('visual');
      setCodeString(simAstString);
      setValidationError(null);
      setIsModalOpen(true);
    } catch (err: any) {
      alert(`Failed to load simulator rule: ${err.message || err}`);
    }
  };

  const handleExportRuleset = () => {
    try {
      const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
        JSON.stringify(rules, null, 2)
      )}`;
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', jsonString);
      downloadAnchor.setAttribute('download', 'trackmanager_ruleset.json');
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (err) {
      console.error('Failed to export ruleset:', err);
    }
  };

  const handleExportIndividualRule = (rule: Rule) => {
    try {
      const isStandardObj = rule.conditions && typeof rule.conditions === 'object' && !Array.isArray(rule.conditions);
      const op = isStandardObj ? rule.conditions.logicalOperator || 'AND' : 'AND';
      const conds = isStandardObj ? rule.conditions.conditions || [] : (Array.isArray(rule.conditions) ? rule.conditions : []);

      const portableRule = {
        name: rule.name,
        description: rule.description,
        isActive: rule.isActive,
        targetType: rule.targetType,
        conditions: isStandardObj ? rule.conditions : { logicalOperator: op, conditions: conds }
      };
      const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
        JSON.stringify(portableRule, null, 2)
      )}`;
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', jsonString);
      downloadAnchor.setAttribute('download', `rule_${rule.name.toLowerCase().replace(/\s+/g, '_')}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (err) {
      console.error('Failed to export individual rule:', err);
    }
  };

  const handleImportRuleset = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    fileReader.onload = async (event) => {
      try {
        const importedRules = JSON.parse(event.target?.result as string);
        if (!Array.isArray(importedRules)) {
          alert('Invalid ruleset format. Ruleset must be a JSON array of rules.');
          return;
        }
        
        let successCount = 0;
        let failCount = 0;
        
        for (const rule of importedRules) {
          try {
            const res = await fetch(`${apiBase}/api/rules`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: rule.name || 'Imported Rule',
                description: rule.description || '',
                isActive: rule.isActive !== undefined ? rule.isActive : true,
                targetType: rule.targetType || 'all',
                conditions: rule.conditions || { logicalOperator: 'AND', conditions: [] }
              })
            });
            if (res.ok) {
              successCount++;
            } else {
              failCount++;
            }
          } catch (err) {
            failCount++;
          }
        }
        
        alert(`Import completed! Successfully imported: ${successCount}. Failed: ${failCount}.`);
        fetchRulesAndFiles();
      } catch (err: any) {
        alert(`Failed to parse ruleset file: ${err.message || err}`);
      }
    };
    fileReader.readAsText(files[0]);
  };

  const handleImportIndividualRule = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    fileReader.onload = async (event) => {
      try {
        const rule = JSON.parse(event.target?.result as string);
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
          alert('Invalid format. File must represent a single rule JSON object.');
          return;
        }
        if (!rule.name || !rule.conditions) {
          alert('Invalid rule schema. Missing "name" or "conditions" configuration.');
          return;
        }
        
        const res = await fetch(`${apiBase}/api/rules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: rule.name || 'Imported Individual Rule',
            description: rule.description || '',
            isActive: rule.isActive !== undefined ? rule.isActive : true,
            targetType: rule.targetType || 'all',
            conditions: rule.conditions
          })
        });
        
        if (res.ok) {
          alert('Individual rule imported successfully!');
          fetchRulesAndFiles();
        } else {
          const err = await res.json();
          alert(`Failed to import individual rule: ${err.error || 'Server error'}`);
        }
      } catch (err: any) {
        alert(`Failed to parse rule file: ${err.message || err}`);
      }
    };
    fileReader.readAsText(files[0]);
  };

  const handleSimulate = async () => {
    if (!selectedFileId) return;
    setSimLoading(true);
    setSimResult(null);
    try {
      const parsedAst = JSON.parse(simAstString);
      const res = await fetch(`${apiBase}/api/rules/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaItemId: parseInt(selectedFileId, 10),
          conditions: parsedAst
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSimResult(data);
      }
    } catch (err: any) {
      setSimResult({
        passed: false,
        errorMessage: err.message ? `JSON Parse Error: ${err.message}` : 'Failed to parse simulation conditions AST.'
      });
    } finally {
      setSimLoading(false);
    }
  };

  const renderConditionText = (cond: any) => {
    if (cond.field === 'audio') {
      const p = cond.params || {};
      const formatStr = p.format ? ` [Format: ${Array.isArray(p.format) ? p.format.join('/') : p.format}]` : '';
      const chanStr = p.channels ? ` [Channels: ${typeof p.channels === 'object' ? JSON.stringify(p.channels) : p.channels}]` : '';
      return `HAS AUDIO: Lang "${p.language || 'any'}"${formatStr}${chanStr}`;
    }

    if (cond.field === 'subtitles') {
      const p = cond.params || {};
      const formatStr = p.format ? ` [Format: ${Array.isArray(p.format) ? p.format.join('/') : p.format}]` : '';
      const forcedStr = p.isForced ? ' [FORCED]' : '';
      const sdhStr = p.isHearingImpaired ? ' [SDH]' : '';
      return `HAS SUBTITLE: Lang "${p.language || 'any'}"${formatStr}${forcedStr}${sdhStr}`;
    }

    return `${cond.field} ${cond.operator} "${cond.value}"`;
  };

  if (loading && rules.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh', fontFamily: 'var(--font-headings)', fontWeight: 600 }}>
        Loading visual AST builder...
      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px', marginBottom: '30px' }}>
        <div>
          <h1 className="page-title">Compliance Rules Engine</h1>
          <p className="page-subtitle">Configure hierarchical metadata requirements, inspect visual AST connections, and test rules.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={handleExportRuleset}>
            📤 Export Entire Ruleset
          </button>
          <label className="btn btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
            📥 Import Entire Ruleset
            <input 
              type="file" 
              accept=".json" 
              style={{ display: 'none' }} 
              onChange={handleImportRuleset} 
            />
          </label>
          <label className="btn btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
            📄 Import Individual Rule (.json)
            <input 
              type="file" 
              accept=".json" 
              style={{ display: 'none' }} 
              onChange={handleImportIndividualRule} 
            />
          </label>
          <button className="btn btn-primary" onClick={handleStartCreate}>
            ➕ Add Compliance Rule
          </button>
        </div>
      </div>

      {/* --- ROW 1: ACTIVE RULES AST CARDS --- */}
      <h2 style={{ fontSize: '1.4rem', marginBottom: '20px', fontWeight: 700 }}>Active Rules</h2>
      {rules.length === 0 ? (
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)', marginBottom: '40px' }}>
          No custom compliance rules configured yet. Setup a rule below.
        </div>
      ) : (
        <div className="rules-grid">
          {rules.map((rule) => (
            <div className="glass-panel rule-builder-card" key={rule.id} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div className="rule-builder-header">
                  <div>
                    <span className="library-card-type-badge" style={{ marginRight: '8px' }}>{rule.targetType}</span>
                    <label className="switch" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', verticalAlign: 'middle' }}>
                      <input 
                        type="checkbox" 
                        checked={rule.isActive} 
                        style={{ display: 'none' }}
                        onChange={() => handleToggleActive(rule)} 
                      />
                      <span className={`switch-slider ${rule.isActive ? 'active' : ''}`} style={{
                        width: '34px',
                        height: '20px',
                        background: rule.isActive ? 'var(--status-passed-bg)' : 'rgba(255, 255, 255, 0.08)',
                        border: rule.isActive ? 'var(--status-passed-border)' : 'var(--panel-border)',
                        borderRadius: '20px',
                        position: 'relative',
                        display: 'inline-block',
                        transition: 'all 0.2s ease',
                        boxShadow: rule.isActive ? 'var(--status-passed-glow)' : 'none'
                      }}>
                        <span style={{
                          width: '12px',
                          height: '12px',
                          background: rule.isActive ? 'var(--status-passed-text)' : 'var(--text-muted)',
                          borderRadius: '50%',
                          position: 'absolute',
                          top: '3px',
                          left: rule.isActive ? '17px' : '3px',
                          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
                        }} />
                      </span>
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button 
                      style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                      onClick={() => handleStartEdit(rule)}
                    >
                      Edit
                    </button>
                    <button 
                      style={{ background: 'none', border: 'none', color: 'var(--status-failed-text)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                      onClick={() => handleDeleteRule(rule.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <h3 style={{ fontSize: '1.25rem', marginBottom: '6px' }}>{rule.name}</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>{rule.description || 'No description provided.'}</p>

                {/* AST Node connector panels */}
                {(() => {
                  const conds = (rule.conditions && typeof rule.conditions === 'object' && !Array.isArray(rule.conditions))
                    ? rule.conditions.conditions || []
                    : (Array.isArray(rule.conditions) ? rule.conditions : []);

                  const op = (rule.conditions && typeof rule.conditions === 'object' && !Array.isArray(rule.conditions))
                    ? rule.conditions.logicalOperator || 'AND'
                    : 'AND';

                  return (
                    <>
                      {conds.length > 0 && (
                        <div className="logical-operator-badge">{op}</div>
                      )}
                      
                      <div className="ast-nodes-container" style={{ marginBottom: '10px' }}>
                        {conds.length === 0 ? (
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                            (No conditions configured)
                          </div>
                        ) : (
                          conds.map((cond: any, idx: number) => {
                            if (!cond) return null;
                            return (
                              <div className="ast-node" key={idx}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                                  {renderConditionText(cond)}
                                </span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: '6px 12px', fontSize: '0.8rem', borderRadius: '6px', flex: 1 }}
                  onClick={() => handleCopyToSandbox(rule)}
                >
                  🧪 Sandbox
                </button>
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: '6px 12px', fontSize: '0.8rem', borderRadius: '6px', flex: 1 }}
                  onClick={() => handleExportIndividualRule(rule)}
                >
                  📤 Export Rule
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* --- ROW 2: INTERACTIVE COMPLIANCE AST SIMULATOR --- */}
      <div id="compliance-simulator-pane" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '30px', marginTop: '40px' }}>
        
        {/* Simulator AST Code Input */}
        <div className="glass-panel" style={{ padding: '30px' }}>
          <h2 style={{ fontSize: '1.3rem', marginBottom: '10px', fontWeight: 600 }}>Compliance Simulator</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
            Test your condition expressions inside a temporary sandbox before saving rules to the database.
          </p>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px', fontWeight: 600 }}>
              SELECT MEDIA FILE FOR SIMULATION
            </label>
            {testFiles.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No media files indexed to test. Trigger scan first.</p>
            ) : (
              <select 
                className="form-select"
                value={selectedFileId}
                onChange={(e) => setSelectedFileId(e.target.value)}
              >
                {testFiles.map(f => (
                  <option key={f.id} value={f.id}>{f.title || f.fileName}</option>
                ))}
              </select>
            )}
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px', fontWeight: 600 }}>
              AST JSON CONDITION
            </label>
            <textarea
              className="form-input"
              rows={8}
              style={{ fontFamily: 'monospace', fontSize: '0.8rem', background: '#02050b' }}
              value={simAstString}
              onChange={(e) => setSimAstString(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSimulate} disabled={simLoading || !selectedFileId}>
              {simLoading ? 'Auditing file...' : '⚡ Simulate Audit'}
            </button>
            <button 
              className="btn btn-secondary" 
              style={{ width: '100%', borderColor: 'rgba(16, 185, 129, 0.25)', color: 'var(--status-passed-text)' }}
              onClick={handleSaveSimulatorRule}
            >
              📥 Save Simulator Rule to Database
            </button>
          </div>
        </div>

        {/* Simulator Feedback Outputs */}
        <div className="glass-panel" style={{ padding: '30px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: '1.3rem', marginBottom: '10px', fontWeight: 600 }}>Simulation Feedback</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '30px' }}>
              Results are calculated instantly in memory against the file's indexed tracks.
            </p>

            {simResult ? (
              <div style={{ animation: 'scaleUp 0.3s ease-out' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                  <span className={simResult.passed ? 'badge badge-passed' : 'badge badge-failed'} style={{ fontSize: '1rem', padding: '6px 16px' }}>
                    {simResult.passed ? '✓ PASSED' : '✕ FAILING'}
                  </span>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    Compliance state confirmed
                  </span>
                </div>

                {!simResult.passed && simResult.errorMessage && (
                  <div style={{ padding: '16px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', color: 'var(--status-failed-text)', fontSize: '0.9rem', lineHeight: '1.5' }}>
                    <strong>Failing Reason:</strong>
                    <p style={{ marginTop: '6px' }}>⚠️ {simResult.errorMessage}</p>
                  </div>
                )}

                {simResult.passed && (
                  <div style={{ padding: '16px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: '8px', color: 'var(--status-passed-text)', fontSize: '0.9rem' }}>
                    🎉 The media file fits all rules defined in your simulation AST!
                  </div>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '50px 0', fontSize: '0.9rem' }}>
                Trigger simulator to compile logic checks.
              </div>
            )}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '15px' }}>
            Tip: Copy conditions from your active cards to test edits!
          </div>
        </div>
      </div>

      {/* --- ADD/EDIT COMPLIANCE RULE MODAL --- */}
      {isModalOpen && (
        <div className="drawer-backdrop" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div className="glass-panel" style={{ width: '700px', padding: '30px', animation: 'scaleUp 0.3s ease-out', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '1.4rem' }}>{editingRuleId ? 'Edit Compliance Rule' : 'Configure Compliance Rule'}</h3>
              <button className="drawer-close-btn" onClick={handleCloseModal}>✕</button>
            </div>
            
            {formError && (
              <div style={{ padding: '10px 15px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '16px', border: '1px solid rgba(239,68,68,0.2)' }}>
                {formError}
              </div>
            )}

            {/* --- VISUAL VS JSON CODE TAB SWITCH --- */}
            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', marginBottom: '20px' }}>
              <button 
                type="button"
                style={{
                  flex: 1,
                  padding: '10px',
                  background: editorMode === 'visual' ? 'rgba(0, 242, 254, 0.08)' : 'none',
                  border: 'none',
                  borderBottom: editorMode === 'visual' ? '2px solid var(--accent-cyan)' : 'none',
                  color: editorMode === 'visual' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem'
                }}
                onClick={() => {
                  if (editorMode === 'code' && validationError) {
                    alert('Please resolve JSON syntax validation errors before swapping to Visual Builder.');
                    return;
                  }
                  setEditorMode('visual');
                }}
              >
                🎨 Visual Builder
              </button>
              <button 
                type="button"
                style={{
                  flex: 1,
                  padding: '10px',
                  background: editorMode === 'code' ? 'rgba(0, 242, 254, 0.08)' : 'none',
                  border: 'none',
                  borderBottom: editorMode === 'code' ? '2px solid var(--accent-cyan)' : 'none',
                  color: editorMode === 'code' ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem'
                }}
                onClick={() => {
                  // Synchronize current Visual fields to stringified JSON AST code view
                  const currentAst = {
                    logicalOperator: logicalOp,
                    conditions: formConditions
                  };
                  setCodeString(JSON.stringify(currentAst, null, 2));
                  setValidationError(null);
                  setEditorMode('code');
                }}
              >
                💻 JSON Code Editor
              </button>
            </div>

            <form onSubmit={handleCreateRule} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px', fontWeight: 600 }}>
                    RULE NAME
                  </label>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="e.g. Subtitles Check"
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600, margin: 0 }}>
                      TARGET TYPE
                    </label>
                    <a 
                      href="#" 
                      onClick={handleSelectAll} 
                      style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', textDecoration: 'none', fontWeight: 600 }}
                    >
                      Select All
                    </a>
                  </div>
                  <div style={{ display: 'flex', gap: '15px', alignItems: 'center', height: '38px', background: 'rgba(0,0,0,0.2)', border: 'var(--panel-border)', borderRadius: '8px', padding: '0 12px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', margin: 0 }}>
                      <input 
                        type="checkbox" 
                        checked={targetType.split(',').map(s => s.trim().toLowerCase()).includes('movie')}
                        onChange={(e) => handleCheckboxChange('movie', e.target.checked)}
                        style={{ accentColor: 'var(--accent-cyan)' }}
                      />
                      Movies
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', margin: 0 }}>
                      <input 
                        type="checkbox" 
                        checked={targetType.split(',').map(s => s.trim().toLowerCase()).includes('tv')}
                        onChange={(e) => handleCheckboxChange('tv', e.target.checked)}
                        style={{ accentColor: 'var(--accent-cyan)' }}
                      />
                      TV Shows
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', margin: 0 }}>
                      <input 
                        type="checkbox" 
                        checked={targetType.split(',').map(s => s.trim().toLowerCase()).includes('anime')}
                        onChange={(e) => handleCheckboxChange('anime', e.target.checked)}
                        style={{ accentColor: 'var(--accent-cyan)' }}
                      />
                      Anime
                    </label>
                  </div>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px', fontWeight: 600 }}>
                  DESCRIPTION
                </label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. Audits files to ensure they contain English subtitles"
                  value={ruleDesc}
                  onChange={(e) => setRuleDesc(e.target.value)}
                />
              </div>

              {editorMode === 'visual' ? (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h4 style={{ fontSize: '1rem' }}>AST Conditions Expressions</h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <select 
                        className="form-select" 
                        style={{ padding: '4px 8px', fontSize: '0.8rem', width: '90px' }}
                        value={logicalOp}
                        onChange={(e) => setLogicalOp(e.target.value as 'AND' | 'OR')}
                      >
                        <option value="AND">AND</option>
                        <option value="OR">OR</option>
                      </select>
                      <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={handleAddCondition}>
                        ➕ Add Clause
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {formConditions.map((cond, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '12px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '8px', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', width: '100%', gap: '10px', alignItems: 'center' }}>
                          <select 
                            className="form-select" 
                            style={{ flex: 1.5 }}
                            value={cond.field}
                            onChange={(e) => handleConditionChange(idx, 'field', e.target.value)}
                          >
                            <option value="videoCodec">Video Codec</option>
                            <option value="videoResolution">Resolution</option>
                            <option value="videoColorDepth">Color Depth</option>
                            <option value="videoHdrFormat">HDR Profile</option>
                            <option value="container">Container</option>
                            <option value="audio">Audio Tracks</option>
                            <option value="subtitles">Subtitle Tracks</option>
                          </select>

                          {cond.field !== 'audio' && cond.field !== 'subtitles' ? (
                            <>
                              <select 
                                className="form-select" 
                                style={{ flex: 1.2 }}
                                value={cond.operator}
                                onChange={(e) => handleConditionChange(idx, 'operator', e.target.value)}
                              >
                                <option value="EQUALS">EQUALS</option>
                                <option value="CONTAINS">CONTAINS</option>
                                <option value="GTE">GTE (&gt;=)</option>
                                <option value="LTE">LTE (&lt;=)</option>
                              </select>
                              <input 
                                type="text" 
                                className="form-input" 
                                style={{ flex: 2 }}
                                placeholder="e.g. HEVC"
                                value={cond.value || ''}
                                onChange={(e) => handleConditionChange(idx, 'value', e.target.value)}
                              />
                            </>
                          ) : (
                            <div style={{ flex: 3.2, fontSize: '0.85rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                              {cond.field === 'audio' ? '🔊 Custom Audio Filters' : '📝 Custom Subtitle Filters'}
                            </div>
                          )}

                          <button type="button" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }} onClick={() => handleRemoveCondition(idx)}>
                            ✕
                          </button>
                        </div>

                        {/* --- GRANULAR CUSTOM AUDIO FORM --- */}
                        {cond.field === 'audio' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', padding: '10px', background: 'rgba(255,255,255,0.02)', border: 'var(--panel-border)', boxSizing: 'border-box' }}>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>LANG:</span>
                              <input 
                                type="text" 
                                className="form-input" 
                                style={{ padding: '4px 8px', fontSize: '0.8rem', width: '70px' }}
                                placeholder="eng"
                                value={cond.params?.language || ''}
                                onChange={(e) => handleParamChange(idx, 'language', e.target.value)}
                              />
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>MIN CHANNELS:</span>
                              <input 
                                type="number" 
                                className="form-input" 
                                style={{ padding: '4px 8px', fontSize: '0.8rem', width: '60px' }}
                                placeholder="6"
                                value={parseChannelsValue(cond.params?.channels)}
                                onChange={(e) => handleParamChange(idx, 'channels', e.target.value ? `>= ${e.target.value}` : undefined)}
                              />
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', marginTop: '4px' }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>CODECS SELECTOR:</span>
                              {['TrueHD', 'DTS-HD', 'DTS', 'AAC', 'AC-3', 'OPUS'].map(codec => {
                                const formatsArray = Array.isArray(cond.params?.format) 
                                  ? cond.params.format 
                                  : cond.params?.format 
                                    ? [cond.params.format] 
                                    : [];
                                const isChecked = formatsArray.includes(codec);
                                return (
                                  <label key={codec} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
                                    <input 
                                      type="checkbox" 
                                      checked={isChecked}
                                      style={{ width: '13px', height: '13px', accentColor: 'var(--accent-cyan)', cursor: 'pointer' }}
                                      onChange={(e) => {
                                        const newFormats = e.target.checked 
                                          ? [...formatsArray, codec] 
                                          : formatsArray.filter((f: string) => f !== codec);
                                        handleParamChange(idx, 'format', newFormats);
                                      }}
                                    />
                                    {codec}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* --- GRANULAR CUSTOM SUBTITLE FORM --- */}
                        {cond.field === 'subtitles' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', padding: '10px', background: 'rgba(255,255,255,0.02)', border: 'var(--panel-border)', boxSizing: 'border-box' }}>
                            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>LANG:</span>
                              <input 
                                type="text" 
                                className="form-input" 
                                style={{ padding: '4px 8px', fontSize: '0.8rem', width: '70px' }}
                                placeholder="eng"
                                value={cond.params?.language || ''}
                                onChange={(e) => handleParamChange(idx, 'language', e.target.value)}
                              />
                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
                                <input 
                                  type="checkbox" 
                                  checked={!!cond.params?.isForced}
                                  style={{ width: '13px', height: '13px', accentColor: 'var(--accent-cyan)', cursor: 'pointer' }}
                                  onChange={(e) => handleParamChange(idx, 'isForced', e.target.checked)}
                                />
                                Forced Only
                              </label>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
                                <input 
                                  type="checkbox" 
                                  checked={!!cond.params?.isHearingImpaired}
                                  style={{ width: '13px', height: '13px', accentColor: 'var(--accent-cyan)', cursor: 'pointer' }}
                                  onChange={(e) => handleParamChange(idx, 'isHearingImpaired', e.target.checked)}
                                />
                                SDH (Hearing Impaired)
                              </label>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', marginTop: '4px' }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>FORMATS SELECTOR:</span>
                              {['SRT', 'PGS', 'ASS', 'VobSub'].map(subFormat => {
                                const subFormatsArray = Array.isArray(cond.params?.format) 
                                  ? cond.params.format 
                                  : cond.params?.format 
                                    ? [cond.params.format] 
                                    : [];
                                const isChecked = subFormatsArray.includes(subFormat);
                                return (
                                  <label key={subFormat} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
                                    <input 
                                      type="checkbox" 
                                      checked={isChecked}
                                      style={{ width: '13px', height: '13px', accentColor: 'var(--accent-cyan)', cursor: 'pointer' }}
                                      onChange={(e) => {
                                        const newSubFormats = e.target.checked 
                                          ? [...subFormatsArray, subFormat] 
                                          : subFormatsArray.filter((f: string) => f !== subFormat);
                                        handleParamChange(idx, 'format', newSubFormats);
                                      }}
                                    />
                                    {subFormat}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                // --- GRANULAR CODE EDITOR WITH SCHEMA VALIDATION ---
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    AST JSON CODE
                  </label>
                  {validationError && (
                    <div style={{
                      padding: '12px 16px',
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      borderRadius: '8px',
                      color: 'var(--status-failed-text)',
                      fontSize: '0.85rem',
                      boxShadow: '0 0 15px rgba(239, 68, 68, 0.1)'
                    }}>
                      ⚠️ <strong>Schema Violation:</strong> {validationError}
                    </div>
                  )}
                  <textarea 
                    className="form-input" 
                    rows={12} 
                    style={{ fontFamily: 'monospace', fontSize: '0.85rem', background: '#02050b' }}
                    value={codeString}
                    onChange={(e) => handleCodeChange(e.target.value)}
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={handleCloseModal}>
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  style={{ flex: 1 }}
                  disabled={editorMode === 'code' && validationError !== null}
                >
                  {editingRuleId ? 'Update Rule' : 'Save Compliance Rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
