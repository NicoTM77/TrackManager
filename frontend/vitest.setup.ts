import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock global fetch
global.fetch = vi.fn();

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      if (options?.fileName) {
        return `File "${options.fileName}" was missing from local storage directory and marked as inactive.`;
      }
      if (options?.version) {
        return `Version: ${options.version} (Self-Hosted)`;
      }
      const keyParts = key.split('.');
      const finalKey = keyParts[keyParts.length - 1];
      const translations: Record<string, string> = {
        complianceScore: 'Compliance Score',
        passed: 'PASSED',
        generalStats: 'General Statistics',
        movies: 'MOVIES',
        episodes: 'EPISODES',
        activeAudits: 'ACTIVE AUDITS',
        ghostRemoved: 'GHOST/REMOVED',
        complianceSimulator: 'Compliance Simulator',
        activeRules: 'Active Rules'
      };
      return translations[finalKey] || finalKey;
    },
    i18n: {
      changeLanguage: () => Promise.resolve(),
      language: 'en',
    },
  }),
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
}));

