import { createPortal } from 'react-dom';
import { useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';

type FloatingDropdownProps<TAnchor extends HTMLElement = HTMLElement> = {
  open: boolean;
  anchorRef: RefObject<TAnchor | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  align?: 'start' | 'end';
  className?: string;
  id?: string;
  role?: string;
  labelledBy?: string;
  width?: number;
  matchAnchorWidth?: boolean;
};

export function FloatingDropdown<TAnchor extends HTMLElement = HTMLElement>({
  open,
  anchorRef,
  menuRef,
  children,
  align = 'end',
  className,
  id,
  role,
  labelledBy,
  width,
  matchAnchorWidth = false
}: FloatingDropdownProps<TAnchor>) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return undefined;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const viewportPadding = 12;
      const desiredWidth = width ?? (matchAnchorWidth ? rect.width : 232);
      const maxWidth = Math.max(160, window.innerWidth - viewportPadding * 2);
      const menuWidth = Math.min(desiredWidth, maxWidth);
      const rawLeft = align === 'end' ? rect.right - menuWidth : rect.left;
      const left = Math.min(Math.max(viewportPadding, rawLeft), window.innerWidth - viewportPadding - menuWidth);
      const top = Math.min(rect.bottom + 6, window.innerHeight - viewportPadding);

      setStyle({
        position: 'fixed',
        top,
        left,
        width: menuWidth,
        zIndex: 1000
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [align, anchorRef, matchAnchorWidth, open, width]);

  if (!open || typeof document === 'undefined' || !style) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={className}
      id={id}
      role={role}
      aria-labelledby={labelledBy}
      data-floating="true"
      data-align={align}
      style={style}
    >
      {children}
    </div>,
    document.body
  );
}
