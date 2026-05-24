import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  controlSize?: InputSize;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, controlSize = 'md', invalid = false, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn('ui-input', `ui-input-${controlSize}`, invalid && 'ui-input-invalid', className)}
      aria-invalid={invalid || props['aria-invalid']}
      {...props}
    />
  );
});
