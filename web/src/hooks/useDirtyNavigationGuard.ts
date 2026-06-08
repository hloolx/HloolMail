import { useEffect, useRef } from 'react';

export function useDirtyNavigationGuard(enabled: boolean, message: string) {
  const enabledRef = useRef(enabled);
  const messageRef = useRef(message);
  const lastHashRef = useRef('');
  const revertingRef = useRef(false);

  useEffect(() => {
    enabledRef.current = enabled;
    messageRef.current = message;
    if (!enabled && typeof window !== 'undefined') {
      lastHashRef.current = window.location.hash;
    }
  }, [enabled, message]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    lastHashRef.current = window.location.hash;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!enabledRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    const handleHashChange = () => {
      const nextHash = window.location.hash;
      const previousHash = lastHashRef.current;

      if (revertingRef.current) {
        revertingRef.current = false;
        lastHashRef.current = nextHash;
        return;
      }

      if (!enabledRef.current || sameHashPath(previousHash, nextHash)) {
        lastHashRef.current = nextHash;
        return;
      }

      if (window.confirm(messageRef.current)) {
        lastHashRef.current = nextHash;
        return;
      }

      revertingRef.current = true;
      window.location.hash = previousHash || '#/dashboard';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);
}

function sameHashPath(left: string, right: string) {
  return hashPath(left) === hashPath(right);
}

function hashPath(hash: string) {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const queryIndex = raw.indexOf('?');
  return queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
}
