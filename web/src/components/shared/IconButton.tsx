import type { MouseEventHandler, ReactNode } from 'react';

export function IconButton({ title, children, onClick, disabled, className = '' }: { title: string; children: ReactNode; onClick?: MouseEventHandler<HTMLButtonElement>; disabled?: boolean; className?: string }) {
  return (
    <button className={`icon-btn ${className}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
