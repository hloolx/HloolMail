import type { MouseEvent as ReactMouseEvent } from 'react';
import { flushSync } from 'react-dom';
import type { ThemeMode } from '../store';

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function resolveTheme(mode: ThemeMode) {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

export function animateThemeSwitch(event: ReactMouseEvent<HTMLButtonElement>, nextMode: ThemeMode, setTheme: (theme: ThemeMode) => void) {
  const x = event.clientX;
  const y = event.clientY;
  const root = document.documentElement;
  const nextTheme = resolveTheme(nextMode);
  const currentTheme = root.classList.contains('dark') ? 'dark' : 'light';
  const applyTheme = () => {
    root.classList.toggle('dark', nextTheme === 'dark');
    setTheme(nextMode);
  };

  if (nextTheme === currentTheme) {
    setTheme(nextMode);
    return;
  }

  if (prefersReducedMotion()) {
    flushSync(applyTheme);
    return;
  }

  const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

  root.style.setProperty('--theme-x', `${x}px`);
  root.style.setProperty('--theme-y', `${y}px`);
  root.style.setProperty('--theme-radius', `${endRadius}px`);

  const cleanup = () => {
    root.classList.remove('theme-switching');
    root.style.removeProperty('--theme-x');
    root.style.removeProperty('--theme-y');
    root.style.removeProperty('--theme-radius');
  };
  const viewTransition = (
    document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> };
    }
  ).startViewTransition?.bind(document);

  if (viewTransition) {
    root.classList.add('theme-switching');
    viewTransition(() => flushSync(applyTheme)).finished.finally(cleanup);
    return;
  }

  const ripple = document.createElement('span');
  ripple.className = 'theme-ripple';
  ripple.style.setProperty('--theme-x', `${x}px`);
  ripple.style.setProperty('--theme-y', `${y}px`);
  ripple.style.setProperty('--theme-radius', `${endRadius}px`);
  ripple.style.background = nextTheme === 'dark' ? '#0f0f0f' : '#ffffff';
  document.body.appendChild(ripple);
  requestAnimationFrame(() => ripple.classList.add('theme-ripple-active'));
  window.setTimeout(() => flushSync(applyTheme), 300);
  window.setTimeout(() => ripple.remove(), 720);
}
