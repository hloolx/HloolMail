
export function Field({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  disabled = false,
  id,
  required = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
  disabled?: boolean;
  id?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1 text-sm" htmlFor={id}>
      <span className="text-[var(--muted)]">
        {label}
        {required && <span className="install-required" aria-hidden="true">*</span>}
      </span>
      <input className="input" value={value} type={type} disabled={disabled} id={id} onChange={(event) => onChange(event.target.value)} />
      {hint && <span className="text-xs leading-5 text-[var(--muted)]">{hint}</span>}
    </label>
  );
}
