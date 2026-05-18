

export function CodeBlock({ children }: { children: string }) {
  return <code className="block rounded-lg border border-[var(--border)] bg-[var(--soft)] p-3 text-xs">{children}</code>;
}
