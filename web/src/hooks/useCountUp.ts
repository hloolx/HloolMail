import { useEffect, useMemo, useRef, useState } from 'react';

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useCountUp(target: number, duration = 600) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);
  const valueRef = useRef(0);
  const reduceMotion = useMemo(() => prefersReducedMotion(), []);

  useEffect(() => {
    if (reduceMotion) {
      setDisplay(target);
      valueRef.current = target;
      return;
    }

    const startValue = valueRef.current;
    const startTime = performance.now();

    const animate = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startValue + (target - startValue) * eased);
      valueRef.current = current;
      setDisplay(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration, reduceMotion]);

  return display;
}
