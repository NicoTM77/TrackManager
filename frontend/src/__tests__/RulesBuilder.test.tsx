import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RulesBuilder } from '../components/RulesBuilder';

describe('RulesBuilder Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders active rules, conditions builder, and sandbox simulator successfully', async () => {
    const mockRules = [
      {
        id: 1,
        name: 'Stereo Audio Rule',
        description: 'Requires stereo audio format',
        isActive: true,
        targetType: 'all',
        conditions: {
          logicalOperator: 'AND',
          conditions: [
            {
              field: 'audio',
              operator: 'HAS_AUDIO',
              params: { channels: 2 }
            }
          ]
        }
      }
    ];

    const mockMedia = {
      items: [
        {
          id: 1,
          fileName: 'Test_File.mkv',
          title: 'Test Movie Title',
        }
      ],
      total: 1
    };

    // Setup global fetch mock
    vi.mocked(global.fetch).mockImplementation((url) => {
      if (String(url).endsWith('/api/rules')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockRules),
        } as any);
      }
      if (String(url).includes('/api/media')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockMedia),
        } as any);
      }
      return Promise.reject(new Error('Unknown URL: ' + url));
    });

    render(<RulesBuilder apiBase="http://localhost:3000" />);

    // Wait for rules to load and render
    await waitFor(() => {
      expect(screen.getByText('Stereo Audio Rule')).toBeDefined();
    });

    expect(screen.getByText('Requires stereo audio format')).toBeDefined();
    expect(screen.getByText('Compliance Simulator')).toBeDefined();
    expect(screen.getByText('Active Rules')).toBeDefined();
  });
});
