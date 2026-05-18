import type { ReactNode } from 'react';

export function CenteredState({ children }: { children: ReactNode }) {
  return <div className="grid min-h-screen place-items-center bg-[var(--background)] text-sm text-[var(--muted)]">{children}</div>;
}
