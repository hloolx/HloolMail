import { ApiError } from '../api';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const APP_VERSION = import.meta.env.VITE_APP_VERSION as string | undefined;
const APP_ENV = (import.meta.env.VITE_APP_ENV as string | undefined) ?? import.meta.env.MODE;

let initialized = false;
let provider: MonitoringProvider = noopProvider();

type SentryModule = typeof import('@sentry/react');

export type MonitoringUser = { id: string | number } & Record<string, unknown>;

export type MonitoringBreadcrumb = {
  category: string;
  message: string;
  level?: 'info' | 'warning' | 'error';
  data?: Record<string, unknown>;
};

interface MonitoringProvider {
  captureException: (error: unknown, context?: Record<string, unknown>) => void;
  captureMessage: (message: string, level?: 'info' | 'warning' | 'error') => void;
  setUser: (user: MonitoringUser | null) => void;
  setTag: (key: string, value: string | number | boolean | undefined) => void;
  addBreadcrumb: (breadcrumb: MonitoringBreadcrumb) => void;
}

function noopProvider(): MonitoringProvider {
  return {
    captureException: () => {},
    captureMessage: () => {},
    setUser: () => {},
    setTag: () => {},
    addBreadcrumb: () => {}
  };
}

function isNoiseError(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status === 401) return true;
    if (error.kind === 'business' || error.status === 422) return true;
    if (error.kind === 'abort' || error.status === 0) return true;
  }
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  return false;
}

function sentryProvider(Sentry: SentryModule): MonitoringProvider {
  return {
    captureException: (error, context) => {
      Sentry.captureException(error, context ? { extra: context } : undefined);
    },
    captureMessage: (message, level = 'info') => {
      Sentry.captureMessage(message, level);
    },
    setUser: (user) => {
      Sentry.setUser(user);
    },
    setTag: (key, value) => {
      if (value === undefined) return;
      Sentry.setTag(key, value);
    },
    addBreadcrumb: (breadcrumb) => {
      Sentry.addBreadcrumb(breadcrumb);
    }
  };
}

export async function initMonitoring(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (!SENTRY_DSN) {
    if (import.meta.env.DEV) {
      console.info('[monitoring] disabled (set VITE_SENTRY_DSN to enable)');
    }
    return;
  }

  try {
    const Sentry = await import('@sentry/react');
    Sentry.init({
      dsn: SENTRY_DSN,
      release: APP_VERSION ? `hlool-mail-web@${APP_VERSION}` : undefined,
      environment: APP_ENV,
      tracesSampleRate: APP_ENV === 'production' ? 0.1 : 1.0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0.1,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.extraErrorDataIntegration(),
        Sentry.httpClientIntegration()
      ],
      ignoreErrors: [
        'top.GLOBALS',
        'ResizeObserver loop',
        'ResizeObserver loop completed with undelivered notifications',
        'Network request failed',
        'Failed to fetch',
        'Load failed'
      ],
      denyUrls: [/extensions\//i, /^chrome:\/\//i, /^chrome-extension:\/\//i]
    });
    provider = sentryProvider(Sentry);
  } catch (error) {
    console.warn('[monitoring] failed to initialize', error);
  }
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (isNoiseError(error)) return;
  try {
    provider.captureException(error, context);
  } catch {
    // Monitoring failures must never break product flows.
  }
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  try {
    provider.captureMessage(message, level);
  } catch {
    // Monitoring failures must never break product flows.
  }
}

export function setMonitoringUser(user: MonitoringUser | null): void {
  try {
    provider.setUser(user);
  } catch {
    // Monitoring failures must never break product flows.
  }
}

export function setMonitoringTag(key: string, value: string | number | boolean | undefined): void {
  try {
    provider.setTag(key, value);
  } catch {
    // Monitoring failures must never break product flows.
  }
}

export function addBreadcrumb(breadcrumb: MonitoringBreadcrumb): void {
  try {
    provider.addBreadcrumb(breadcrumb);
  } catch {
    // Monitoring failures must never break product flows.
  }
}

export const isMonitoringEnabled = () => Boolean(SENTRY_DSN);
