import React, { useState, useEffect } from 'react';

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
  path: string;
  type: 'movie' | 'tv';
}

interface TreeNode {
  name: string;
  type: 'folder' | 'file';
  path: string;
  children: TreeNode[];
  item?: MediaItem;
  libraryId?: number;
  libraryType?: 'movie' | 'tv';
  isSeriesFolder?: boolean;
  absolutePath?: string;
}

interface Prefs {
  resolution: boolean;
  codec: boolean;
  audio: boolean;
  subtitles: boolean;
  compliance: boolean;
}

interface SeriesMeta {
  id: number;
  libraryId: number;
  seriesPath: string;
  seriesName: string;
  type: 'tv' | 'anime';
}

interface ExplorePanelProps {
  apiBase: string;
}

const DEFAULT_PREFS: Prefs = {
  resolution: true,
  codec: true,
  audio: true,
  subtitles: true,
  compliance: true
};

export const ExplorePanel: React.FC<ExplorePanelProps> = ({ apiBase }) => {
  const [loading, setLoading] = useState(true);
  const [seriesMetadata, setSeriesMetadata] = useState<SeriesMeta[]>([]);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [showSettings, setShowSettings] = useState(false);

  // Drawer & Accordion States for Detail Drawer
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [rawMetadata, setRawMetadata] = useState<any>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeAccordion, setActiveAccordion] = useState<string | null>('compliance');

  // Client-Side Preferences via LocalStorage
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const saved = localStorage.getItem('trackmanager_explore_prefs');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return DEFAULT_PREFS;
      }
    }
    return DEFAULT_PREFS;
  });

  const togglePref = (key: keyof Prefs) => {
    const nextPrefs = { ...prefs, [key]: !prefs[key] };
    setPrefs(nextPrefs);
    localStorage.setItem('trackmanager_explore_prefs', JSON.stringify(nextPrefs));
  };

  const handleResetDefaults = () => {
    setPrefs(DEFAULT_PREFS);
    localStorage.removeItem('trackmanager_explore_prefs');
    setShowSettings(false);
  };

  const formatBytes = (bytes: number, decimals = 2) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const handleCopyRaw = () => {
    if (!rawMetadata) return;
    navigator.clipboard.writeText(JSON.stringify(rawMetadata, null, 2))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(err => console.error('Failed to copy raw metadata:', err));
  };

  const handleToggleSeriesType = async (e: React.MouseEvent, node: TreeNode) => {
    e.stopPropagation();
    if (!node.libraryId || !node.absolutePath) return;
    
    const currentMeta = seriesMetadata.find(meta => meta.seriesPath === node.absolutePath);
    const currentType = currentMeta ? currentMeta.type : 'tv';
    const newType = currentType === 'tv' ? 'anime' : 'tv';
    
    setSeriesMetadata(prev => {
      const exists = prev.some(m => m.seriesPath === node.absolutePath);
      if (exists) {
        return prev.map(m => m.seriesPath === node.absolutePath ? { ...m, type: newType } : m);
      } else {
        return [...prev, {
          id: Date.now(),
          libraryId: node.libraryId!,
          seriesPath: node.absolutePath!,
          seriesName: node.name,
          type: newType
        }];
      }
    });

    try {
      const res = await fetch(`${apiBase}/api/series/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          libraryId: node.libraryId,
          seriesPath: node.absolutePath,
          seriesName: node.name,
          type: newType
        })
      });
      if (!res.ok) {
        loadData();
      } else {
        const metaRes = await fetch(`${apiBase}/api/series/metadata`);
        if (metaRes.ok) {
          const seriesData = await metaRes.json();
          setSeriesMetadata(seriesData);
        }
      }
    } catch (err) {
      console.error('Failed to toggle series type:', err);
      loadData();
    }
  };

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

  const loadData = async () => {
    setLoading(true);
    try {
      const [libRes, mediaRes, seriesRes] = await Promise.all([
        fetch(`${apiBase}/api/libraries`),
        fetch(`${apiBase}/api/media?limit=1000&status=active`),
        fetch(`${apiBase}/api/series/metadata`)
      ]);
      if (libRes.ok && mediaRes.ok && seriesRes.ok) {
        const libs = await libRes.json();
        const media = await mediaRes.json();
        const seriesData = await seriesRes.json();
        setSeriesMetadata(seriesData);
        buildDirectoryTree(libs, media.items);
      }
    } catch (err) {
      console.error('Failed to load explore panel data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [apiBase]);

  // Build Directory Tree grouping files recursively by relative library paths
  const buildDirectoryTree = (libs: Library[], items: MediaItem[]) => {
    const roots: TreeNode[] = libs.map(lib => ({
      name: lib.name,
      type: 'folder',
      path: `lib_${lib.id}`,
      children: [],
      libraryId: lib.id,
      libraryType: lib.type
    }));

    const rootsMap = new Map<number, TreeNode>();
    roots.forEach((root, idx) => {
      rootsMap.set(libs[idx].id, root);
    });

    items.forEach(item => {
      const lib = libs.find(l => l.id === item.libraryId);
      if (!lib) return;

      const rootNode = rootsMap.get(lib.id);
      if (!rootNode) return;

      // Extract relative path relative to library root
      let relativePath = item.filePath;
      if (relativePath.startsWith(lib.path)) {
        relativePath = relativePath.slice(lib.path.length);
      }
      
      const parts = relativePath.split('/').filter(Boolean);
      let currentFolder = rootNode;

      parts.forEach((part, partIdx) => {
        const isLast = partIdx === parts.length - 1;
        const currentPath = `${currentFolder.path}/${part}`;

        if (isLast) {
          // File node
          currentFolder.children.push({
            name: part,
            type: 'file',
            path: currentPath,
            children: [],
            item: item,
            libraryId: lib.id,
            libraryType: lib.type
          });
        } else {
          // Folder node
          let folderNode = currentFolder.children.find(c => c.name === part && c.type === 'folder');
          if (!folderNode) {
            folderNode = {
              name: part,
              type: 'folder',
              path: currentPath,
              children: [],
              libraryId: lib.id,
              libraryType: lib.type,
              isSeriesFolder: currentFolder === rootNode && lib.type === 'tv',
              absolutePath: currentFolder === rootNode && lib.type === 'tv' ? (lib.path.endsWith('/') ? `${lib.path}${part}` : `${lib.path}/${part}`) : undefined
            };
            currentFolder.children.push(folderNode);
          }
          currentFolder = folderNode;
        }
      });
    });

    // Recursively sort children (folders first, then alphabetically)
    const sortTree = (node: TreeNode) => {
      node.children.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      node.children.forEach(sortTree);
    };

    roots.forEach(sortTree);
    setTreeData(roots);

    // Expand top-level libraries by default
    const defaultExpanded: Record<string, boolean> = {};
    roots.forEach(r => {
      defaultExpanded[r.path] = true;
    });
    setExpandedPaths(defaultExpanded);
  };

  const toggleFolder = (path: string) => {
    setExpandedPaths(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const renderTree = (nodes: TreeNode[], depth: number = 0) => {
    return nodes.map(node => {
      const isFolder = node.type === 'folder';
      const isExpanded = expandedPaths[node.path];

      if (isFolder) {
        const meta = seriesMetadata.find(m => m.seriesPath === node.absolutePath);
        const seriesType = meta ? meta.type : 'tv';

        return (
          <div key={node.path} style={{ display: 'flex', flexDirection: 'column', marginTop: '4px' }}>
            <div 
              onClick={() => toggleFolder(node.path)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontFamily: 'var(--font-headings)',
                fontWeight: depth === 0 ? 700 : 500,
                fontSize: depth === 0 ? '1rem' : '0.9rem',
                color: depth === 0 ? 'var(--accent-cyan)' : 'var(--text-primary)',
                background: depth === 0 ? 'rgba(0, 242, 254, 0.04)' : 'transparent',
                border: depth === 0 ? 'var(--panel-border-active)' : 'none',
                marginLeft: `${depth * 16}px`,
                transition: 'all 0.2s ease'
              }}
            >
              <span style={{ fontSize: '0.8rem', userSelect: 'none' }}>{isExpanded ? '▼' : '▶'}</span>
              <span style={{ fontSize: '1.1rem' }}>📁</span>
              <span>{node.name}</span>

              {node.isSeriesFolder && (
                seriesType === 'anime' ? (
                  <span 
                    onClick={(e) => handleToggleSeriesType(e, node)}
                    style={{
                      marginLeft: 'auto',
                      marginRight: '12px',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      background: 'linear-gradient(135deg, #9b51e0, #7b2cbf)',
                      border: '1px solid rgba(155, 81, 224, 0.3)',
                      boxShadow: '0 0 10px rgba(155, 81, 224, 0.4)',
                      color: '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      userSelect: 'none'
                    }}
                  >
                    ✨ Anime
                  </span>
                ) : (
                  <span 
                    onClick={(e) => handleToggleSeriesType(e, node)}
                    style={{
                      marginLeft: 'auto',
                      marginRight: '12px',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      backdropFilter: 'blur(8px)',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      userSelect: 'none'
                    }}
                  >
                    📺 Regular TV
                  </span>
                )
              )}
            </div>
            {isExpanded && node.children.length > 0 && renderTree(node.children, depth + 1)}
          </div>
        );
      }

      // File Row Rendering
      const item = node.item;
      if (!item) return null;

      const failingAudits = item.auditResults.filter(aud => !aud.passed);
      const isFailing = failingAudits.length > 0;

      return (
        <div 
          key={node.path}
          onClick={() => handleRowClick(item)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            borderRadius: '8px',
            marginLeft: `${(depth * 16) + 12}px`,
            marginTop: '3px',
            background: 'rgba(255, 255, 255, 0.01)',
            borderLeft: `2px solid ${isFailing && prefs.compliance ? 'var(--status-failed-text)' : 'rgba(255, 255, 255, 0.05)'}`,
            gap: '12px',
            flexWrap: 'wrap',
            cursor: 'pointer'
          }}
        >
          {/* File Left: Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '200px' }}>
            <span>📄</span>
            <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
              {item.title || item.fileName}
              {item.season !== null && item.episode !== null && (
                <strong style={{ color: 'var(--accent-cyan)' }}>{` [S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}]`}</strong>
              )}
            </span>
          </div>

          {/* File Right: Inline Metadata Badges Enforced by LocalStorage Prefs */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {prefs.resolution && item.videoResolution && (
              <span className="badge" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: 'var(--panel-border)', padding: '2px 8px', fontSize: '0.75rem' }}>
                🎬 {item.videoResolution}
              </span>
            )}
            
            {prefs.codec && item.videoCodec && (
              <span className="badge" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', border: 'var(--panel-border)', padding: '2px 8px', fontSize: '0.75rem' }}>
                🎥 {item.videoCodec}
              </span>
            )}

            {prefs.audio && item.audioTracks.map((track, trackIdx) => (
              <span key={`audio-${trackIdx}`} className="badge" style={{ background: 'rgba(0, 242, 254, 0.04)', color: 'var(--accent-cyan)', border: 'var(--panel-border-active)', padding: '2px 8px', fontSize: '0.75rem' }}>
                🔊 {track.language?.toUpperCase() || 'UND'} ({track.format})
              </span>
            ))}

            {prefs.subtitles && item.subtitleTracks.map((track, trackIdx) => (
              <span key={`sub-${trackIdx}`} className="badge" style={{ background: 'rgba(155, 81, 224, 0.04)', color: 'var(--accent-amethyst)', border: '1px solid rgba(155, 81, 224, 0.25)', padding: '2px 8px', fontSize: '0.75rem' }}>
                📝 {track.language?.toUpperCase() || 'UND'} ({track.format})
              </span>
            ))}

            {prefs.compliance && (
              isFailing ? (
                <span className="badge badge-failed" style={{ padding: '2px 8px', fontSize: '0.75rem' }}>
                  ✕ Failed
                </span>
              ) : item.auditResults.length > 0 ? (
                <span className="badge badge-passed" style={{ padding: '2px 8px', fontSize: '0.75rem' }}>
                  ✓ Passed
                </span>
              ) : (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No audits</span>
              )
            )}
          </div>
        </div>
      );
    });
  };

  return (
    <div style={{ animation: 'fadeIn 0.4s ease-out', position: 'relative' }}>
      {/* Explore Header Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px', marginBottom: '30px' }}>
        <div>
          <h1 className="page-title">Physical Explorer</h1>
          <p className="page-subtitle">Inspect local library folders, expand nested directory structures, and review inline codec metadata.</p>
        </div>

        {/* Display Preferences Widget Panel */}
        <div style={{ position: 'relative' }}>
          <button 
            className="btn btn-secondary" 
            onClick={() => setShowSettings(!showSettings)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            ⚙️ Display Settings
          </button>

          {showSettings && (
            <>
              <div 
                onClick={() => setShowSettings(false)} 
                style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9 }}
              />
              <div 
                className="glass-panel" 
                style={{
                  position: 'absolute',
                  top: '46px',
                  right: 0,
                  width: '240px',
                  padding: '20px',
                  zIndex: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  animation: 'scaleUp 0.25s ease-out'
                }}
              >
                <h4 style={{ fontSize: '0.9rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px', marginBottom: '4px' }}>
                  Filter Columns View
                </h4>
                
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={prefs.resolution}
                    onChange={() => togglePref('resolution')}
                    style={{ accentColor: 'var(--accent-cyan)' }}
                  />
                  Video Resolution
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={prefs.codec}
                    onChange={() => togglePref('codec')}
                    style={{ accentColor: 'var(--accent-cyan)' }}
                  />
                  Video Codec
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={prefs.audio}
                    onChange={() => togglePref('audio')}
                    style={{ accentColor: 'var(--accent-cyan)' }}
                  />
                  All Audio Tracks
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={prefs.subtitles}
                    onChange={() => togglePref('subtitles')}
                    style={{ accentColor: 'var(--accent-cyan)' }}
                  />
                  All Subtitle Tracks
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={prefs.compliance}
                    onChange={() => togglePref('compliance')}
                    style={{ accentColor: 'var(--accent-cyan)' }}
                  />
                  Compliance Audits State
                </label>

                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
                  <button 
                    onClick={handleResetDefaults} 
                    className="btn btn-secondary" 
                    style={{ width: '100%', fontSize: '0.75rem', padding: '6px' }}
                  >
                    Reset defaults
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Directory Canvas */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '40vh', fontFamily: 'var(--font-headings)', fontWeight: 600 }}>
          Resolving nested directories tree...
        </div>
      ) : treeData.length === 0 ? (
        <div className="glass-panel" style={{ padding: '60px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          No active libraries configured or indexed files to explore. Connect paths in the overview.
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: '24px 30px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {renderTree(treeData)}
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
                  {selectedItem.container} format
                </span>
                <h2 className="drawer-title">{selectedItem.title || selectedItem.fileName}</h2>
                {selectedItem.season !== null && (
                  <span style={{ fontSize: '1rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                    Season {selectedItem.season}, Episode {selectedItem.episode}
                  </span>
                )}
              </div>
              <button className="drawer-close-btn" onClick={() => setIsDrawerOpen(false)}>✕</button>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '15px', wordBreak: 'break-all' }}>
              Filepath: {selectedItem.filePath}
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
                  <span>⚖️ Rule Audits ({selectedItem.auditResults.length})</span>
                  <span>{activeAccordion === 'compliance' ? '▼' : '▶'}</span>
                </div>
                {activeAccordion === 'compliance' && (
                  <div className="accordion-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {selectedItem.auditResults.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)' }}>No compliance audits have been run against this file yet. Set up rules and trigger library scans.</p>
                    ) : (
                      selectedItem.auditResults.map(aud => (
                        <div key={aud.ruleId} style={{ display: 'flex', gap: '10px', flexDirection: 'column', padding: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <strong style={{ fontFamily: 'var(--font-headings)' }}>{aud.ruleName}</strong>
                            <span className={aud.passed ? 'badge badge-passed' : 'badge badge-failed'} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>
                              {aud.passed ? 'Passed' : 'Failed'}
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
                  <span>🎥 Video Track Metadata</span>
                  <span>{activeAccordion === 'video' ? '▼' : '▶'}</span>
                </div>
                {activeAccordion === 'video' && (
                  <div className="accordion-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>CODEC</div>
                      <div style={{ fontWeight: 600, color: '#fff' }}>{selectedItem.videoCodec || 'Unknown'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>RESOLUTION</div>
                      <div style={{ fontWeight: 600, color: '#fff' }}>{selectedItem.videoResolution || 'Unknown'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>COLOR DEPTH</div>
                      <div style={{ fontWeight: 600, color: '#fff' }}>{selectedItem.videoColorDepth ? `${selectedItem.videoColorDepth}-bit` : '8-bit'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>HDR PROFILE</div>
                      <div style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>{selectedItem.videoHdrFormat || 'SDR'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>BITRATE</div>
                      <div style={{ fontWeight: 600, color: '#fff' }}>{selectedItem.videoBitrate ? `${Math.round(selectedItem.videoBitrate / 1000000)} Mbps` : 'N/A'}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>FILESIZE</div>
                      <div style={{ fontWeight: 600, color: '#fff' }}>{formatBytes(selectedItem.fileSize)}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Audio Tracks Info */}
              <div className="accordion-item">
                <div className="accordion-header" onClick={() => setActiveAccordion(activeAccordion === 'audio' ? null : 'audio')}>
                  <span>🔊 Audio Tracks ({selectedItem.audioTracks.length})</span>
                  <span>{activeAccordion === 'audio' ? '▼' : '▶'}</span>
                </div>
                {activeAccordion === 'audio' && (
                  <div className="accordion-body" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {selectedItem.audioTracks.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)' }}>No audio tracks detected.</p>
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
                            {track.isDefault && <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>default</span>}
                            {track.isForced && <span style={{ fontSize: '0.7rem', background: 'rgba(0,242,254,0.1)', color: 'var(--accent-cyan)', padding: '2px 6px', borderRadius: '4px' }}>forced</span>}
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
                  <span>📝 Subtitle Tracks ({selectedItem.subtitleTracks.length})</span>
                  <span>{activeAccordion === 'subtitles' ? '▼' : '▶'}</span>
                </div>
                {activeAccordion === 'subtitles' && (
                  <div className="accordion-body" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {selectedItem.subtitleTracks.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)' }}>No subtitle tracks detected.</p>
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
                            {track.isHearingImpaired && <span style={{ fontSize: '0.7rem', background: 'rgba(245,158,11,0.1)', color: 'var(--status-removed-text)', padding: '2px 6px', borderRadius: '4px' }}>SDH</span>}
                            {track.isDefault && <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>default</span>}
                            {track.isForced && <span style={{ fontSize: '0.7rem', background: 'rgba(0,242,254,0.1)', color: 'var(--accent-cyan)', padding: '2px 6px', borderRadius: '4px' }}>forced</span>}
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
                  <span>⚙️ Raw MediaInfo JSON</span>
                  <span>{activeAccordion === 'raw' ? '▼' : '▶'}</span>
                </div>
                {activeAccordion === 'raw' && (
                  <div className="accordion-body" style={{ padding: '10px 0 0 0', borderTop: 'none' }}>
                    {rawLoading ? (
                      <p style={{ color: 'var(--text-muted)', padding: '15px' }}>Probing file headers...</p>
                    ) : rawMetadata ? (
                      <div className="code-viewer-wrapper">
                        <button className="copy-btn" onClick={handleCopyRaw}>
                          {copied ? 'Copied! ✓' : 'Copy'}
                        </button>
                        <pre style={{ color: 'var(--accent-cyan)' }}>{JSON.stringify(rawMetadata, null, 2)}</pre>
                      </div>
                    ) : (
                      <p style={{ color: 'var(--status-failed-text)', padding: '15px' }}>Failed to retrieve raw headers.</p>
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
