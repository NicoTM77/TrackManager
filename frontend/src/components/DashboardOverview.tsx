import React, { useState, useEffect } from 'react';

interface Library {
  id: number;
  name: string;
  path: string;
  type: 'movie' | 'tv';
  status: 'idle' | 'scanning';
  lastScannedAt: string | null;
}

interface Stats {
  moviesCount: number;
  episodesCount: number;
  complianceScore: number;
  totalAudits: number;
  passedAudits: number;
  totalRemoved: number;
  qualityDistribution: Record<string, number>;
  containerDistribution: Record<string, number>;
  codecDistribution: Record<string, number>;
}

interface DashboardOverviewProps {
  apiBase: string;
  onNavigateToAudit: (libraryId?: number, failedOnly?: boolean) => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({ apiBase, onNavigateToAudit }) => {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Library addition modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newLibName, setNewLibName] = useState('');
  const [newLibPath, setNewLibPath] = useState('');
  const [newLibType, setNewLibType] = useState<'movie' | 'tv'>('movie');
  const [formError, setFormError] = useState('');

  const fetchData = async () => {
    try {
      const [libRes, statsRes] = await Promise.all([
        fetch(`${apiBase}/api/libraries`),
        fetch(`${apiBase}/api/stats/overview`)
      ]);
      if (libRes.ok && statsRes.ok) {
        const libs = await libRes.json();
        const overviewStats = await statsRes.json();
        setLibraries(libs);
        setStats(overviewStats);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Poll for library scanning status and stats updates every 5 seconds
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [apiBase]);

  const handleScan = async (libraryId: number) => {
    // Optimistically set to scanning
    setLibraries(prev => prev.map(lib => lib.id === libraryId ? { ...lib, status: 'scanning' } : lib));
    try {
      const res = await fetch(`${apiBase}/api/libraries/${libraryId}/scan`, { method: 'POST' });
      if (!res.ok) {
        fetchData(); // rollback/refresh
      }
    } catch (err) {
      console.error('Failed to trigger scan:', err);
      fetchData();
    }
  };

  const handleCreateLibrary = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!newLibName || !newLibPath) {
      setFormError('Please fill in all fields.');
      return;
    }

    try {
      const res = await fetch(`${apiBase}/api/libraries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newLibName,
          path: newLibPath,
          type: newLibType
        })
      });

      if (res.ok) {
        setNewLibName('');
        setNewLibPath('');
        setIsModalOpen(false);
        fetchData();
      } else {
        const errData = await res.json();
        setFormError(errData.error || 'Failed to create library.');
      }
    } catch (err) {
      setFormError('Network error occurred.');
    }
  };

  const handleDeleteLibrary = async (id: number) => {
    if (!confirm('Are you sure you want to delete this library configuration? All indexed metadata and compliance history will be deleted.')) {
      return;
    }

    try {
      const res = await fetch(`${apiBase}/api/libraries/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Failed to delete library:', err);
    }
  };

  if (loading && !stats) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh', fontFamily: 'var(--font-headings)', fontWeight: 600 }}>
        Loading analytical hub...
      </div>
    );
  }

  // Calculate radial gauge offsets
  const complianceVal = stats?.complianceScore ?? 100;
  const strokeDasharray = 2 * Math.PI * 80; // circum = 502.65
  const strokeDashoffset = strokeDasharray - (complianceVal / 100) * strokeDasharray;

  return (
    <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '30px' }}>
        <div>
          <h1 className="page-title">Library Overview</h1>
          <p className="page-subtitle">Real-time health audits, storage layouts, and sync status summaries.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
          ➕ Add Library
        </button>
      </div>

      {/* --- ROW 1: HEALTH RADIAL GAUGE & STORAGE METRICS --- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px', marginBottom: '40px' }}>
        
        {/* Compliance Radial Gauge Card */}
        <div className="glass-panel" style={{ padding: '30px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '280px' }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '20px', textAlign: 'center', fontWeight: 600 }}>Compliance Score</h2>
          <div className="compliance-gauge-wrapper">
            <svg width="180" height="180" className="gauge-svg">
              <defs>
                <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#00f2fe" />
                  <stop offset="100%" stopColor="#9b51e0" />
                </linearGradient>
              </defs>
              <circle cx="90" cy="90" r="80" className="gauge-bg" />
              <circle 
                cx="90" 
                cy="90" 
                r="80" 
                className="gauge-fill" 
                strokeDasharray={strokeDasharray} 
                strokeDashoffset={strokeDashoffset}
              />
            </svg>
            <div className="gauge-center-text">
              <div className="gauge-value">{complianceVal}%</div>
              <div className="gauge-label">PASSED</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '20px', marginTop: '20px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <div>Passed: <strong>{stats?.passedAudits ?? 0}</strong></div>
            <div>|</div>
            <div>Total Checks: <strong>{stats?.totalAudits ?? 0}</strong></div>
          </div>
        </div>

        {/* Media Distribution Stat Cards */}
        <div className="glass-panel" style={{ padding: '30px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: '280px' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '20px', fontWeight: 600 }}>General Statistics</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>MOVIES</div>
                <div style={{ fontSize: '2.2rem', fontFamily: 'var(--font-headings)', fontWeight: 800, color: 'var(--accent-cyan)' }}>
                  {stats?.moviesCount ?? 0}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>EPISODES</div>
                <div style={{ fontSize: '2.2rem', fontFamily: 'var(--font-headings)', fontWeight: 800, color: 'var(--accent-amethyst)' }}>
                  {stats?.episodesCount ?? 0}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>ACTIVE AUDITS</div>
                <div style={{ fontSize: '1.5rem', fontFamily: 'var(--font-headings)', fontWeight: 700 }}>
                  {stats?.totalAudits ?? 0}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px' }}>GHOST/REMOVED</div>
                <div style={{ fontSize: '1.5rem', fontFamily: 'var(--font-headings)', fontWeight: 700, color: 'var(--status-removed-text)' }}>
                  {stats?.totalRemoved ?? 0}
                </div>
              </div>
            </div>
          </div>
          <div style={{ marginTop: '20px', borderTop: '1px solid rgba(255, 255, 255, 0.04)', paddingTop: '15px' }}>
            <button className="btn btn-secondary" style={{ width: '100%', padding: '8px' }} onClick={() => onNavigateToAudit(undefined, true)}>
              ⚠️ Inspect Failing Files
            </button>
          </div>
        </div>

        {/* Video Quality Distributions */}
        <div className="glass-panel" style={{ padding: '30px', minHeight: '280px' }}>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '20px', fontWeight: 600 }}>Quality Distribution</h2>
          <div className="micro-chart-container">
            {stats && Object.entries(stats.qualityDistribution).map(([label, val]) => {
              const totalItems = stats.moviesCount + stats.episodesCount;
              const percent = totalItems > 0 ? Math.round((val / totalItems) * 100) : 0;
              return (
                <div className="micro-chart-row" key={label}>
                  <div className="micro-chart-header">
                    <span>{label}</span>
                    <span>{val} ({percent}%)</span>
                  </div>
                  <div className="micro-chart-bar-bg">
                    <div className="micro-chart-bar-fill" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* --- ROW 2: ACTIVE LIBRARIES GRIDS --- */}
      <h2 style={{ fontSize: '1.5rem', marginBottom: '20px', fontWeight: 700 }}>Media Libraries</h2>
      {libraries.length === 0 ? (
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <p style={{ marginBottom: '16px' }}>No media library directories registered yet.</p>
          <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>Configure First Path</button>
        </div>
      ) : (
        <div className="libraries-grid">
          {libraries.map((lib) => (
            <div className="glass-panel library-card" key={lib.id}>
              <div className="library-card-header">
                <span className="library-card-type-badge">{lib.type}</span>
                <button 
                  style={{ background: 'none', border: 'none', color: 'var(--status-failed-text)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                  onClick={() => handleDeleteLibrary(lib.id)}
                >
                  Remove
                </button>
              </div>
              <h3 className="library-card-title">{lib.name}</h3>
              <p className="library-card-path">{lib.path}</p>
              
              <div className="library-card-footer">
                <div>
                  {lib.status === 'scanning' ? (
                    <div className="scanning-indicator">
                      <span className="scanning-dot" />
                      Scanning...
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Last Sync: {lib.lastScannedAt ? new Date(lib.lastScannedAt).toLocaleTimeString() : 'Never'}
                    </span>
                  )}
                </div>
                
                <button 
                  className={`btn ${lib.status === 'scanning' ? 'btn-secondary' : 'btn-primary'}`}
                  style={{ padding: '6px 12px', fontSize: '0.8rem', borderRadius: '6px' }}
                  disabled={lib.status === 'scanning'}
                  onClick={() => handleScan(lib.id)}
                >
                  {lib.status === 'scanning' ? 'Scanning...' : '🔄 Scan Now'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* --- LIBRARY CONFIGURATION MODAL --- */}
      {isModalOpen && (
        <div className="drawer-backdrop" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div className="glass-panel" style={{ width: '450px', padding: '30px', animation: 'scaleUp 0.3s ease-out', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '1.4rem' }}>Configure Media Path</h3>
              <button className="drawer-close-btn" onClick={() => setIsModalOpen(false)}>✕</button>
            </div>
            
            {formError && (
              <div style={{ padding: '10px 15px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '16px', border: '1px solid rgba(239,68,68,0.2)' }}>
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateLibrary} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px', fontWeight: 600 }}>
                  LIBRARY NAME
                </label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. My Movie Shelf"
                  value={newLibName}
                  onChange={(e) => setNewLibName(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px', fontWeight: 600 }}>
                  ABSOLUTE PATH
                </label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. /media/movies"
                  value={newLibPath}
                  onChange={(e) => setNewLibPath(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px', fontWeight: 600 }}>
                  MEDIA CONTENT TYPE
                </label>
                <select 
                  className="form-select"
                  value={newLibType}
                  onChange={(e) => setNewLibType(e.target.value as 'movie' | 'tv')}
                >
                  <option value="movie">Movies (Individual Files)</option>
                  <option value="tv">TV Shows (Series/Seasons/Episodes)</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  Confirm Path
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
