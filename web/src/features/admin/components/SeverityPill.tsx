import type { ReactNode } from 'react';

export function SeverityPill({
  severity,
  children
}: {
  severity: 'ok' | 'warning' | 'critical';
  children: ReactNode;
}) {
  return <span className={`severity-pill severity-${severity}`}>{children}</span>;
}
