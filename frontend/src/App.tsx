import { useState } from 'react';
import { DashboardOverview } from './components/DashboardOverview';
import { ExplorePanel } from './components/ExplorePanel';
import { AuditGrid } from './components/AuditGrid';
import { RulesBuilder } from './components/RulesBuilder';
import { HistoryPanel } from './components/HistoryPanel';

type Tab = 'dashboard' | 'explore' | 'audit' | 'rules' | 'history';

// Decoupled API endpoint resolving to local port in development and root relative in production
const API_BASE = window.location.port === '5173' ? 'http://localhost:3000' : '';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  
  // Navigation states shared between components
  const [initialLibraryId, setInitialLibraryId] = useState<number | undefined>(undefined);
  const [initialFailedOnly, setInitialFailedOnly] = useState<boolean | undefined>(undefined);

  const handleNavigateToAudit = (libraryId?: number, failedOnly?: boolean) => {
    setInitialLibraryId(libraryId);
    setInitialFailedOnly(failedOnly);
    setActiveTab('audit');
  };

  const handleTabChange = (tab: Tab) => {
    // Reset passing navigation states if clicked manually
    setInitialLibraryId(undefined);
    setInitialFailedOnly(undefined);
    setActiveTab(tab);
  };

  return (
    <div className="app-container">
      {/* --- SIDEBAR NAVIGATION --- */}
      <aside className="app-sidebar glass-panel" style={{ borderRadius: '0px', borderLeft: 'none', borderTop: 'none', borderBottom: 'none' }}>
        <div className="sidebar-logo">
          TrackManager
        </div>
        
        <nav className="sidebar-nav">
          <button 
            className={`sidebar-link ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => handleTabChange('dashboard')}
          >
            📊 Dashboard
          </button>
          <button 
            className={`sidebar-link ${activeTab === 'explore' ? 'active' : ''}`}
            onClick={() => handleTabChange('explore')}
          >
            📁 Explore
          </button>
          <button 
            className={`sidebar-link ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => handleTabChange('audit')}
          >
            ⚖️ Audit Center
          </button>
          <button 
            className={`sidebar-link ${activeTab === 'rules' ? 'active' : ''}`}
            onClick={() => handleTabChange('rules')}
          >
            ⚙️ Custom Rules
          </button>
          <button 
            className={`sidebar-link ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => handleTabChange('history')}
          >
            👻 Ghost History
          </button>
        </nav>

        <div style={{ marginTop: 'auto', padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', border: 'var(--panel-border)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          <div>Server: <strong style={{ color: 'var(--accent-cyan)' }}>Online</strong></div>
          <div style={{ marginTop: '4px' }}>Version: 1.0.0 (Self-Hosted)</div>
        </div>
      </aside>

      {/* --- MAIN PAGE CONTENT CANVAS --- */}
      <main className="app-content">
        {activeTab === 'dashboard' && (
          <DashboardOverview 
            apiBase={API_BASE} 
            onNavigateToAudit={handleNavigateToAudit}
          />
        )}
        
        {activeTab === 'explore' && (
          <ExplorePanel 
            apiBase={API_BASE}
          />
        )}
        
        {activeTab === 'audit' && (
          <AuditGrid 
            apiBase={API_BASE}
            initialLibraryId={initialLibraryId}
            initialFailedOnly={initialFailedOnly}
          />
        )}
        
        {activeTab === 'rules' && (
          <RulesBuilder 
            apiBase={API_BASE}
          />
        )}
        
        {activeTab === 'history' && (
          <HistoryPanel 
            apiBase={API_BASE}
          />
        )}
      </main>
    </div>
  );
}

export default App;
