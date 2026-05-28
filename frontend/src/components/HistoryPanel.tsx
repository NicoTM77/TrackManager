import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface RemovedItem {
  id: number;
  filePath: string;
  fileName: string;
  fileSize: number;
  container: string;
  videoResolution: string | null;
  videoCodec: string | null;
  removedAt: string | null;
  title: string | null;
}

interface HistoryPanelProps {
  apiBase: string;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({ apiBase }) => {
  const { t } = useTranslation();
  const [removedItems, setRemovedItems] = useState<RemovedItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRemoved = async () => {
    try {
      const res = await fetch(`${apiBase}/api/media?status=removed&limit=100`);
      if (res.ok) {
        const data = await res.json();
        setRemovedItems(data.items);
      }
    } catch (err) {
      console.error('Failed to fetch historical removed items:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRemoved();
  }, [apiBase]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh', fontFamily: 'var(--font-headings)', fontWeight: 600 }}>
        {t('history.loading')}
      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
      <h1 className="page-title">{t('history.title')}</h1>
      <p className="page-subtitle">{t('history.subtitle')}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '30px', marginTop: '30px' }}>
        
        {/* Left Side: Ghost Files List */}
        <div>
          <h2 style={{ fontSize: '1.3rem', marginBottom: '20px', fontWeight: 700 }}>{t('history.removedFiles')}</h2>
          {removedItems.length === 0 ? (
            <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              {t('history.noRemovedFiles')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {removedItems.map(item => (
                <div className="glass-panel audit-row ghost-row" key={item.id} style={{ cursor: 'default' }}>
                  <div className="audit-row-main">
                    <div className="audit-row-title">
                      👻 {item.title || item.fileName}
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', wordBreak: 'break-all', marginTop: '2px', marginBottom: '6px' }}>
                      {item.filePath}
                    </p>
                    <div className="audit-row-meta">
                      <span>🎬 {item.videoCodec || 'Unknown'} ({item.videoResolution || 'SD'})</span>
                      <span>📂 {item.container.toUpperCase()}</span>
                      <span>💾 {formatBytes(item.fileSize)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Side: Timeline of events */}
        <div>
          <h2 style={{ fontSize: '1.3rem', marginBottom: '20px', fontWeight: 700 }}>{t('history.eventsTimeline')}</h2>
          {removedItems.length === 0 ? (
            <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              {t('history.emptyTimeline')}
            </div>
          ) : (
            <div className="history-timeline">
              {removedItems.map(item => (
                <div className="timeline-event" key={item.id}>
                  <span className="timeline-dot" />
                  <div className="glass-panel timeline-event-card">
                    <strong style={{ display: 'block', fontSize: '0.95rem' }}>{t('history.assetFlaggedRemoved')}</strong>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {t('history.fileFlaggedRemovedDesc', { fileName: item.fileName })}
                    </span>
                    <div className="timeline-time">
                      📅 {item.removedAt ? new Date(item.removedAt).toLocaleString() : t('history.dateUntracked')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
