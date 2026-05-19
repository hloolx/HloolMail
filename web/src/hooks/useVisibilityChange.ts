import { useCallback, useEffect, useRef, useState } from 'react';

export function useVisibilityChange(onBecomeVisible?: () => void) {
  const [isVisible, setIsVisible] = useState(() => {
    if (typeof document === 'undefined') return true;
    return !document.hidden;
  });

  const callbackRef = useRef(onBecomeVisible);
  callbackRef.current = onBecomeVisible;

  useEffect(() => {
    const handler = () => {
      const visible = !document.hidden;
      setIsVisible(visible);
      if (visible) {
        callbackRef.current?.();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  return { isVisible };
}
