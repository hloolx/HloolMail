import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    type = 'button',
    leadingIcon,
    trailingIcon,
    loading = false,
    disabled,
    children,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn('ui-button', `ui-button-${variant}`, `ui-button-${size}`, loading && 'ui-button-loading', className)}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...props}
    >
      {leadingIcon ? <span className="ui-button-icon-slot">{leadingIcon}</span> : null}
      {children}
      {trailingIcon ? <span className="ui-button-icon-slot">{trailingIcon}</span> : null}
    </button>
  );
});
