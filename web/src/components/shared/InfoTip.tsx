import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';
import { Info } from 'lucide-react';
import { createPortal } from 'react-dom';

interface InfoTipProps {
  text: string;
}

export function InfoTip({ text }: InfoTipProps) {
  const [visible, setVisible] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const hoverRef = useRef(false);

  const recalc = useCallback(() => {
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    setPos({
      position: 'fixed',
      left: Math.round(rect.left + rect.width / 2),
      top: Math.round(rect.top - 6),
      transform: 'translateX(-50%) translateY(-100%)'
    });
  }, []);

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
      if (iconRef.current && !iconRef.current.contains(event.target as Node)) {
        setPinned(false);
        if (!hoverRef.current) setVisible(false);
      }
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

  const show = pinned || visible;
  const active = pinned || hoverRef.current;

  return (
    <span
      ref={iconRef}
      className={`info-tip ${active ? 'info-tip-active' : ''}`}
      onMouseEnter={() => { hoverRef.current = true; setVisible(true); }}
      onMouseLeave={() => { hoverRef.current = false; if (!pinned) setVisible(false); }}
      onClick={(event) => { event.stopPropagation(); setPinned((v) => !v); }}
      role="button"
      tabIndex={0}
      aria-label={text}
    >
      <Info size={14} />
      {show && createPortal(
        <div className={`info-tip-popup ${pinned ? 'info-tip-popup-pinned' : ''}`} style={pos}>
          {text}
        </div>,
        document.body
      )}
    </span>
  );
}
