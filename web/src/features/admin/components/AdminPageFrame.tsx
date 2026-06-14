import type { ReactNode } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useText } from '../../../locales';

export interface Breadcrumb {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface AdminPageFrameProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: Breadcrumb[];
  children: ReactNode;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

export function AdminPageFrame({
  title,
  description,
  actions,
  breadcrumbs,
  children,
  isLoading = false,
  error = null,
  onRetry,
}: AdminPageFrameProps) {
  const text = useText();

  return (
    <div className="admin-page grid gap-4">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="admin-breadcrumbs" aria-label="Breadcrumb">
          <ol className="flex items-center gap-2 text-sm text-[var(--muted)]">
            {breadcrumbs.map((crumb, index) => (
              <li key={index} className="flex items-center gap-2">
                {crumb.href || crumb.onClick ? (
                  crumb.onClick ? (
                    <button
                      type="button"
                      onClick={crumb.onClick}
                      className="hover:text-[var(--foreground)] transition-colors"
                    >
                      {crumb.label}
                    </button>
                  ) : (
                    <a
                      href={crumb.href}
                      className="hover:text-[var(--foreground)] transition-colors"
                    >
                      {crumb.label}
                    </a>
                  )
                ) : (
                  <span className="text-[var(--foreground)] font-medium">{crumb.label}</span>
                )}
                {index < breadcrumbs.length - 1 && (
                  <span aria-hidden="true">/</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="admin-page-header">
        <div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions && !isLoading && !error && <div>{actions}</div>}
      </div>

      {error ? (
        <div className="panel" role="alert">
          <div className="flex items-start gap-3 p-4">
            <AlertCircle size={20} className="text-[var(--bad)] flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1">
              <h2 className="font-semibold mb-1">Error</h2>
              <p className="text-sm text-[var(--muted)]">{error.message || 'An error occurred'}</p>
            </div>
            {onRetry && (
              <button className="btn-secondary" onClick={onRetry}>
                {text.common.retry}
              </button>
            )}
          </div>
        </div>
      ) : isLoading ? (
        <div className="panel flex items-center justify-center py-12" role="status" aria-live="polite">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={32} className="animate-spin text-[var(--primary)]" aria-hidden="true" />
            <span className="text-sm text-[var(--muted)]">{text.common.loading}</span>
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
