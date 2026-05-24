
import { useId } from 'react';

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  id?: string;
  required?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  hint,
  error,
  disabled = false,
  id,
  required = false,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy
}: FieldProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [ariaDescribedBy, hintId, errorId].filter(Boolean).join(' ');

  return (
    <label className="grid gap-1 text-sm" htmlFor={inputId}>
      <span className="text-[var(--muted)]">
        {label}
        {required && <span className="install-required" aria-hidden="true">*</span>}
      </span>
      <input
        className="input"
        value={value}
        type={type}
        disabled={disabled}
        id={inputId}
        required={required}
        aria-invalid={ariaInvalid ?? (error ? true : undefined)}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <span id={hintId} className="text-xs leading-5 text-[var(--muted)]">{hint}</span>}
      {error && <span id={errorId} className="field-error" role="alert">{error}</span>}
    </label>
  );
}
