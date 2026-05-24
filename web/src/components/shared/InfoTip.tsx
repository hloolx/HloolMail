import { useEffect, useId, useLayoutEffect, useRef, useState, useCallback, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Info } from 'lucide-react';
import { createPortal } from 'react-dom';

interface InfoTipProps {
  text: string;
}

type InfoTipPlacement = 'top' | 'bottom';
type InfoTipPosition = CSSProperties & {
  '--info-tip-arrow-x'?: string;
};

const TOOLTIP_GAP = 8;
const VIEWPORT_MARGIN = 12;
const FALLBACK_TOOLTIP_WIDTH = 220;
const FALLBACK_TOOLTIP_HEIGHT = 36;

export function InfoTip({ text }: InfoTipProps) {
  const [visible, setVisible] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<InfoTipPosition>({});
  const [placement, setPlacement] = useState<InfoTipPlacement>('top');
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const hoverRef = useRef(false);
  const tooltipId = useId();

  const recalc = useCallback(() => {
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    const popupRect = popupRef.current?.getBoundingClientRect();
    const popupWidth = popupRect?.width || FALLBACK_TOOLTIP_WIDTH;
    const popupHeight = popupRect?.height || FALLBACK_TOOLTIP_HEIGHT;
    const idealLeft = rect.left + rect.width / 2;
    const minLeft = VIEWPORT_MARGIN + popupWidth / 2;
    const maxLeft = window.innerWidth - VIEWPORT_MARGIN - popupWidth / 2;
    const left = Math.min(Math.max(idealLeft, minLeft), Math.max(minLeft, maxLeft));
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const nextPlacement = spaceAbove < popupHeight + TOOLTIP_GAP + VIEWPORT_MARGIN && spaceBelow > spaceAbove
      ? 'bottom'
      : 'top';
    const arrowLimit = Math.max(0, popupWidth / 2 - 14);
    const arrowOffset = Math.min(Math.max(idealLeft - left, -arrowLimit), arrowLimit);

    setPlacement(nextPlacement);
    setPos({
      position: 'fixed',
      left: Math.round(left),
      top: Math.round(nextPlacement === 'bottom' ? rect.bottom + TOOLTIP_GAP : rect.top - TOOLTIP_GAP),
      transform: nextPlacement === 'bottom' ? 'translateX(-50%)' : 'translateX(-50%) translateY(-100%)',
      '--info-tip-arrow-x': `${Math.round(arrowOffset)}px`
    });
  }, []);

  useLayoutEffect(() => {
    if (!visible && !pinned) return;
    recalc();
  }, [visible, pinned, recalc, text]);

  useEffect(() => {
    if (!visible && !pinned) return;
    recalc();
    window.addEventListener('scroll', recalc, { passive: true });
    window.addEventListener('resize', recalc);
    return () => {
      window.removeEventListener('scroll', recalc);
      window.removeEventListener('resize', recalc);
    };
  }, [visible, pinned, recalc]);

  useEffect(() => {
    if (!pinned) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target as Node;
      if (iconRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setPinned(false);
      if (!hoverRef.current) setVisible(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPinned(false);
        setVisible(false);
      }
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', key);
    };
  }, [pinned]);

  const togglePinned = useCallback(() => {
    setPinned((current) => {
      const next = !current;
      setVisible(next || hoverRef.current);
      return next;
    });
  }, []);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    togglePinned();
  }, [togglePinned]);

  const show = pinned || visible;
  const active = pinned || hoverRef.current;

  return (
    <span
      ref={iconRef}
      className={`info-tip ${active ? 'info-tip-active' : ''}`}
      onMouseEnter={() => { hoverRef.current = true; setVisible(true); }}
      onMouseLeave={() => { hoverRef.current = false; if (!pinned) setVisible(false); }}
      onClick={(event) => { event.stopPropagation(); togglePinned(); }}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={text}
      aria-describedby={show ? tooltipId : undefined}
      aria-expanded={show}
    >
      <Info size={14} />
      {show && createPortal(
        <div
          ref={popupRef}
          id={tooltipId}
          role="tooltip"
          className={`info-tip-popup ${pinned ? 'info-tip-popup-pinned' : ''}`}
          data-placement={placement}
          style={pos}
        >
          {text}
        </div>,
        document.body
      )}
    </span>
  );
}
