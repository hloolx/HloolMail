import { create } from 'zustand';

const pages = ['dashboard', 'inbox', 'domain-management', 'api-keys', 'api-docs', 'users', 'admin', 'admin-oauth'] as const;

export type Page = (typeof pages)[number];
export type ThemeMode = 'system' | 'light' | 'dark';
export type Language = 'zh-CN' | 'en-US';

type AppState = {
  page: Page;
  email: string;
  apiKey: string;
  theme: ThemeMode;
  language: Language;
  sidebarCollapsed: boolean;
  setPage: (page: Page) => void;
  setEmail: (email: string) => void;
  setAPIKey: (key: string) => void;
  setTheme: (theme: ThemeMode) => void;
  setLanguage: (language: Language) => void;
  toggleSidebar: () => void;
};

const storageKey = (key: string) => `hlool-mail.${key}`;
const defaultPage: Page = 'dashboard';
const pageSet = new Set<Page>(pages);
const pageAliases: Record<string, Page> = {
  'domain-settings': 'domain-management',
  domains: 'domain-management'
};

const readStorage = (key: string) => {
  try { return localStorage.getItem(storageKey(key)); }
  catch { return null; }
};
const writeStorage = (key: string, value: string) => {
  try { localStorage.setItem(storageKey(key), value); }
  catch { /* storage unavailable or full */ }
};
const removeStorage = (key: string) => {
  try { localStorage.removeItem(storageKey(key)); }
  catch { /* storage unavailable */ }
};

const clearStoredAPIKeys = () => {
  try {
    removeStorage('apiKey');
    const legacyPrefix = `${storageKey('apiKeys')}.`;
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(legacyPrefix)) localStorage.removeItem(key);
    }
  } catch {
    // Best effort migration for older builds that cached API keys locally.
  }
};

const isPage = (value: string): value is Page => pageSet.has(value as Page);

const pageFromHashValue = (hash: string): Page => {
  let value = hash.startsWith('#') ? hash.slice(1) : hash;
  value = value.startsWith('/') ? value.slice(1) : value;
  value = value.split('?')[0].trim();

  try {
    value = decodeURIComponent(value);
  } catch {
    return defaultPage;
  }

  return isPage(value) ? value : pageAliases[value] || defaultPage;
};

export const pageFromHash = (): Page => {
  if (typeof window === 'undefined') return defaultPage;
  return pageFromHashValue(window.location.hash);
};

const writePageHash = (page: Page) => {
  if (typeof window === 'undefined') return;

  const hash = `#/${page}`;
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
};

const storedTheme = (): ThemeMode => {
  const value = readStorage('theme');
  return value === 'dark' || value === 'light' || value === 'system' ? value : 'light';
};

const storedLanguage = (): Language => {
  const value = readStorage('language');
  return value === 'en-US' ? 'en-US' : 'zh-CN';
};

const storedSidebarCollapsed = () => {
  const value = readStorage('sidebarCollapsed');
  if (value === 'true' || value === 'false') return value === 'true';
  return typeof window !== 'undefined' ? window.innerWidth < 1024 : false;
};

export const useAppStore = create<AppState>((set, get) => ({
  page: pageFromHash(),
  email: readStorage('email') || '',
  apiKey: '',
  theme: storedTheme(),
  language: storedLanguage(),
  sidebarCollapsed: storedSidebarCollapsed(),
  setPage: (page) => {
    writePageHash(page);
    if (get().page !== page) {
      set({ page });
    }
  },
  setEmail: (email) => {
    writeStorage('email', email);
    set({ email });
  },
  setAPIKey: (apiKey) => {
    removeStorage('apiKey');
    set({ apiKey });
  },
  setTheme: (theme) => {
    writeStorage('theme', theme);
    set({ theme });
  },
  setLanguage: (language) => {
    writeStorage('language', language);
    set({ language });
  },
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    writeStorage('sidebarCollapsed', String(next));
    set({ sidebarCollapsed: next });
  }
}));

let onHashChange: (() => void) | undefined;

function ensureHashSync() {
  if (typeof window === 'undefined') return;
  if (onHashChange) return;
  clearStoredAPIKeys();
  onHashChange = () => {
    const page = pageFromHash();
    if (useAppStore.getState().page !== page) {
      useAppStore.setState({ page });
    }
  };
  window.addEventListener('hashchange', onHashChange);
}

export function destroyHashSync() {
  if (!onHashChange) return;
  window.removeEventListener('hashchange', onHashChange);
  onHashChange = undefined;
}

ensureHashSync();
