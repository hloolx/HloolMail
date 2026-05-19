

export function EmptyState({ label }: { label: string }) {
  return <div className="grid min-h-32 place-items-center rounded-lg border border-dashed border-[var(--border)] text-sm text-[var(--muted)]" role="status" aria-live="polite">{label}</div>;
}
