import { Loader2 } from 'lucide-react';

type LoadingIndicatorProps = {
  label?: string;
  size?: number;
  className?: string;
};

export function LoadingIndicator({ label, size = 16, className = '' }: LoadingIndicatorProps) {
  return (
    <span className={`loading-indicator ${className}`} role="status" aria-live="polite">
      <Loader2 size={size} className="loading-indicator-icon" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <LoadingIndicator label={label} size={18} />
    </div>
  );
}
