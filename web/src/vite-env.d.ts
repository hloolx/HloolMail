/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sentry-compatible DSN. Empty means the monitoring layer stays no-op. */
  readonly VITE_SENTRY_DSN?: string;
  /** Build version used as the monitoring release identifier. */
  readonly VITE_APP_VERSION?: string;
  /** Environment name. Defaults to Vite MODE when unset. */
  readonly VITE_APP_ENV?: string;
  /** Absolute production canonical URL. Empty means no canonical tag is emitted. */
  readonly VITE_CANONICAL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
