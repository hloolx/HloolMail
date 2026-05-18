

export function Field({ label, value, onChange, type = 'text', hint }: { label: string; value: string; onChange: (value: string) => void; type?: string; hint?: string }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <input className="input" value={value} type={type} onChange={(event) => onChange(event.target.value)} />
      {hint && <span className="text-xs leading-5 text-[var(--muted)]">{hint}</span>}
    </label>
  );
}
