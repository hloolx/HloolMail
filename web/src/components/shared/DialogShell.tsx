import { useEffect, useRef } from 'react';
import type { CSSProperties, FormEventHandler, MouseEvent, ReactNode, RefCallback, RefObject } from 'react';
import { createPortal } from 'react-dom';

type DialogShellProps = {
  children: ReactNode;
  className?: string;
  backdropClassName?: string;
  style?: CSSProperties;
  open?: boolean;
  as?: 'section' | 'form';
  role?: 'dialog' | 'alertdialog';
  titleId?: string;
  descriptionId?: string;
  ariaLabel?: string;
  onClose: () => void;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocus?: boolean;
};

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function DialogShell({
  children,
  className = 'modal-panel',
  backdropClassName = 'modal-backdrop',
  style,
  open = true,
  as = 'section',
  role = 'dialog',
  titleId,
  descriptionId,
  ariaLabel,
  onClose,
  onSubmit,
  closeOnBackdrop = true,
  closeOnEscape = true,
  initialFocusRef,
  restoreFocus = true
}: DialogShellProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      const initialFocus = initialFocusRef?.current;
      if (initialFocus && isFocusable(initialFocus)) {
        initialFocus.focus();
        return;
      }

      const firstFocusable = getFocusableElements(panelRef.current)[0];
      if (firstFocusable) {
        firstFocusable.focus();
        return;
      }

      panelRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      const previous = previousFocusRef.current;
      if (restoreFocus && previous?.isConnected) {
        previous.focus();
      }
    };
  }, [initialFocusRef, open, restoreFocus]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements(panelRef.current);
      if (focusableElements.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (activeElement instanceof Node && !panelRef.current?.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeOnEscape, onClose, open]);

  if (!open || typeof document === 'undefined') return null;

  const setPanelRef: RefCallback<HTMLElement> = (node) => {
    panelRef.current = node;
  };
  const panelStyle: CSSProperties = {
    maxHeight: 'min(92dvh, 52rem)',
    overflowY: 'auto',
    ...style
  };
  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && event.target === event.currentTarget) {
      onClose();
    }
  };

  const panelProps = {
    className,
    role,
    'aria-modal': true,
    'aria-labelledby': titleId,
    'aria-describedby': descriptionId,
    'aria-label': ariaLabel,
    style: panelStyle,
    tabIndex: -1
  };
  const panel = as === 'form' ? (
    <form {...panelProps} ref={setPanelRef as RefCallback<HTMLFormElement>} onSubmit={onSubmit}>
      {children}
    </form>
  ) : (
    <section {...panelProps} ref={setPanelRef as RefCallback<HTMLElement>}>
      {children}
    </section>
  );

  return createPortal(
    <div className={backdropClassName} role="presentation" onMouseDown={handleBackdropMouseDown}>
      {panel}
    </div>,
    document.body
  );
}

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(isFocusable);
}

function isFocusable(element: HTMLElement) {
  if (element.tabIndex < 0) return false;
  if (element.hasAttribute('disabled') || element.getAttribute('aria-hidden') === 'true') return false;

  const style = window.getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none' && element.getClientRects().length > 0;
}
