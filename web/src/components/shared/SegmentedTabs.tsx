import { useCallback, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type SegmentedTabItem<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
};

export type SegmentedTabsProps<T extends string> = {
  value: T;
  items: Array<SegmentedTabItem<T>>;
  onValueChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  size?: 'sm' | 'md';
};

export function SegmentedTabs<T extends string>({
  value,
  items,
  onValueChange,
  ariaLabel,
  className,
  size = 'md'
}: SegmentedTabsProps<T>) {
  const enabledItems = items.filter((item) => !item.disabled);

  const focusTab = useCallback((nextValue: T) => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-segmented-tab-value="${cssEscape(nextValue)}"]`)?.focus();
    });
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (enabledItems.length === 0) return;
    const currentIndex = Math.max(0, enabledItems.findIndex((item) => item.value === value));
    let nextItem: SegmentedTabItem<T> | undefined;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextItem = enabledItems[(currentIndex + 1) % enabledItems.length];
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextItem = enabledItems[(currentIndex - 1 + enabledItems.length) % enabledItems.length];
    } else if (event.key === 'Home') {
      nextItem = enabledItems[0];
    } else if (event.key === 'End') {
      nextItem = enabledItems[enabledItems.length - 1];
    }

    if (!nextItem) return;
    event.preventDefault();
    onValueChange(nextItem.value);
    focusTab(nextItem.value);
  };

  return (
    <div
      className={cn('segmented-tabs', `segmented-tabs-${size}`, className)}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            className="segmented-tab"
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            data-segmented-tab-value={item.value}
            onClick={() => onValueChange(item.value)}
          >
            {item.icon ? <span className="segmented-tab-icon">{item.icon}</span> : null}
            <span className="segmented-tab-label">{item.label}</span>
            {item.badge ? <span className="segmented-tab-badge">{item.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function cssEscape(value: string) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}
