import { useEffect, useState } from 'react';

export function useVisibleRefetchInterval(interval: number | false) {
  const [visible, setVisible] = useState(() => {
    if (typeof document === 'undefined') return true;
    return !document.hidden;
  });

  useEffect(() => {
    const handler = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  return visible ? interval : false;
}
