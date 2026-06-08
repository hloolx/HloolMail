import type { MouseEventHandler, ReactNode } from 'react';

export function IconButton({
  title,
  ariaLabel = title,
  children,
  onClick,
  disabled,
  className = ''
}: {
  title: string;
  ariaLabel?: string;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button type="button" className={`icon-btn ${className}`} title={title} aria-label={ariaLabel} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
