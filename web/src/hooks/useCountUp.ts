import { useEffect, useMemo, useRef, useState } from 'react';

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getCountDuration(target: number, duration?: number) {
  if (duration !== undefined) return Math.max(0, duration);
  const magnitude = Math.abs(target);
  if (magnitude === 0) return 0;
  return Math.round(clamp(650 + Math.log10(magnitude + 1) * 120, 700, 1100));
}

function easeOutQuart(progress: number) {
  return 1 - Math.pow(1 - progress, 4);
}

export function useCountUp(target: number, duration?: number) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);
  const valueRef = useRef(0);
  const reduceMotion = useMemo(() => prefersReducedMotion(), []);
  const safeTarget = Number.isFinite(target) ? Math.round(target) : 0;
  const animationDuration = useMemo(() => getCountDuration(safeTarget, duration), [duration, safeTarget]);

  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (reduceMotion || animationDuration === 0 || valueRef.current === safeTarget) {
      setDisplay(safeTarget);
      valueRef.current = safeTarget;
      return;
    }

    const startValue = valueRef.current;
    const startTime = performance.now();

    const animate = (now: number) => {
      const progress = Math.min((now - startTime) / animationDuration, 1);
      const eased = easeOutQuart(progress);
      const current = Math.round(startValue + (safeTarget - startValue) * eased);
      valueRef.current = current;
      setDisplay(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [animationDuration, reduceMotion, safeTarget]);

  return display;
}
