import { forwardRef, useState } from 'react';
import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { cn } from '../../lib/utils';

export type SwitchSize = 'sm' | 'md';

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: SwitchSize;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { className, checked, defaultChecked = false, onCheckedChange, onClick, disabled, size = 'md', ...props },
  ref
) {
  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const isControlled = checked !== undefined;
  const isChecked = isControlled ? checked : internalChecked;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || disabled) return;

    const nextChecked = !isChecked;
    if (!isControlled) setInternalChecked(nextChecked);
    onCheckedChange?.(nextChecked);
  };

  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={isChecked}
      data-state={isChecked ? 'checked' : 'unchecked'}
      className={cn('ui-switch', `ui-switch-${size}`, isChecked && 'ui-switch-checked', className)}
      disabled={disabled}
      onClick={handleClick}
      {...props}
    >
      <span className="ui-switch-thumb" aria-hidden="true" />
    </button>
  );
});
