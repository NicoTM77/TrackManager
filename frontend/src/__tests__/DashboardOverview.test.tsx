import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardOverview } from '../components/DashboardOverview';

describe('DashboardOverview Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders stats overview card, gauge, and libraries list successfully', async () => {
    const mockLibraries = [
      {
        id: 1,
        name: 'Movies Library',
        path: '/media/movies',
        type: 'movie',
        status: 'idle',
        lastScannedAt: null,
      },
    ];

    const mockStats = {
      moviesCount: 42,
      episodesCount: 15,
      complianceScore: 88,
      totalAudits: 57,
      passedAudits: 50,
      totalRemoved: 2,
      qualityDistribution: { '4K': 10, '1080p': 25, '720p': 5, 'SD': 2 },
      containerDistribution: { MKV: 40, MP4: 2 },
      codecDistribution: { HEVC: 30, AVC: 12 },
    };

    // Setup global fetch mock
    vi.mocked(global.fetch).mockImplementation((url) => {
      if (String(url).endsWith('/api/libraries')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockLibraries),
        } as any);
      }
      if (String(url).endsWith('/api/stats/overview')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockStats),
        } as any);
      }
      return Promise.reject(new Error('Unknown URL: ' + url));
    });

    const handleNavigate = vi.fn();

    render(<DashboardOverview apiBase="http://localhost:3000" onNavigateToAudit={handleNavigate} />);

    // Wait for the data to load and components to render
    await waitFor(() => {
      expect(screen.getByText('Movies Library')).toBeDefined();
    });

    expect(screen.getByText('Compliance Score')).toBeDefined();
    expect(screen.getByText('88%')).toBeDefined(); // Compliance score
    expect(screen.getByText('/media/movies')).toBeDefined();
    expect(screen.getByText('42')).toBeDefined();
    expect(screen.getByText('15')).toBeDefined();
    expect(screen.getByText('MOVIES')).toBeDefined();
    expect(screen.getByText('EPISODES')).toBeDefined();
  });
});
