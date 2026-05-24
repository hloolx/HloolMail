import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { FloatingDropdown } from './FloatingDropdown';

export type SelectDropdownOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type SelectDropdownProps = {
  value: string;
  options: SelectDropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: ReactNode;
  className?: string;
  menuClassName?: string;
  disabled?: boolean;
  align?: 'start' | 'end';
};

export function SelectDropdown({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  className,
  menuClassName,
  disabled = false,
  align = 'start'
}: SelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const selectedOption = useMemo(() => options.find((option) => option.value === value), [options, value]);
  const selectedIndex = useMemo(() => options.findIndex((option) => option.value === value), [options, value]);
  const activeOptionId = open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined;

  const findEnabledIndex = useCallback((start: number, direction: 1 | -1) => {
    if (options.length === 0) return -1;
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (start + (offset * direction) + options.length) % options.length;
      if (!options[index]?.disabled) return index;
    }
    return -1;
  }, [options]);

  const defaultActiveIndex = useCallback(() => {
    if (selectedIndex >= 0 && !options[selectedIndex]?.disabled) return selectedIndex;
    return findEnabledIndex(0, 1);
  }, [findEnabledIndex, options, selectedIndex]);

  const openMenu = useCallback((initialIndex?: number) => {
    if (disabled || options.length === 0) return;
    setActiveIndex(initialIndex ?? defaultActiveIndex());
    setOpen(true);
  }, [defaultActiveIndex, disabled, options.length]);

  const moveActive = useCallback((direction: 1 | -1) => {
    setActiveIndex((current) => {
      const start = current >= 0
        ? current + direction
        : direction === 1 ? 0 : options.length - 1;
      return findEnabledIndex(start, direction);
    });
  }, [findEnabledIndex, options.length]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      } else if (event.key === 'Tab') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionId, open]);

  useEffect(() => {
    if (!open) {
      setActiveIndex(defaultActiveIndex());
      return;
    }
    if (activeIndex < 0 || options[activeIndex]?.disabled) {
      setActiveIndex(defaultActiveIndex());
    }
  }, [activeIndex, defaultActiveIndex, open, options]);

  const choose = (option: SelectDropdownOption, index?: number) => {
    if (option.disabled) return;
    onChange(option.value);
    if (typeof index === 'number') setActiveIndex(index);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled || options.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (open) moveActive(1);
      else openMenu(defaultActiveIndex());
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (open) moveActive(-1);
      else openMenu(defaultActiveIndex());
    } else if (event.key === 'Home') {
      event.preventDefault();
      openMenu(findEnabledIndex(0, 1));
    } else if (event.key === 'End') {
      event.preventDefault();
      openMenu(findEnabledIndex(options.length - 1, -1));
    } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (!open) {
        openMenu(defaultActiveIndex());
        return;
      }
      const activeOption = options[activeIndex];
      if (activeOption) choose(activeOption, activeIndex);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'Tab' && open) {
      setOpen(false);
    }
  };

  return (
    <div className={cn('select-dropdown', className)}>
      <button
        ref={triggerRef}
        className="select-dropdown-trigger"
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={open ? id : undefined}
        aria-activedescendant={activeOptionId}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled || options.length === 0}
        onClick={() => {
          if (open) setOpen(false);
          else openMenu(defaultActiveIndex());
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selectedOption?.label ?? placeholder ?? ''}</span>
        <ChevronDown size={14} aria-hidden="true" data-open={open ? 'true' : undefined} />
      </button>
      <FloatingDropdown
        open={open}
        anchorRef={triggerRef}
        menuRef={menuRef}
        align={align}
        matchAnchorWidth
        className={cn('select-dropdown-menu', menuClassName)}
        id={id}
        role="listbox"
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const active = index === activeIndex;
          return (
            <button
              key={option.value}
              id={`${id}-option-${index}`}
              className="select-dropdown-option"
              type="button"
              role="option"
              aria-selected={selected}
              disabled={option.disabled}
              tabIndex={-1}
              data-active={active ? 'true' : undefined}
              onMouseEnter={() => {
                if (!option.disabled) setActiveIndex(index);
              }}
              onClick={() => choose(option, index)}
            >
              <span>{option.label}</span>
              {selected ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </FloatingDropdown>
    </div>
  );
}
