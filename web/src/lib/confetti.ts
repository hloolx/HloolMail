import confetti from 'canvas-confetti';

export type SuccessBurstOptions = {
  origin?: Element | null;
  x?: number;
  y?: number;
  label?: string;
};

export function resolveSuccessBurstPoint({ origin, x, y }: SuccessBurstOptions) {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x: x as number, y: y as number };
  }
  if (origin) {
    const rect = origin.getBoundingClientRect();
    if (rect.width || rect.height) {
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }
  }
  return {
    x: window.innerWidth / 2,
    y: Math.max(120, window.innerHeight * 0.28)
  };
}

export function launchSuccessBurst(options: SuccessBurstOptions = {}) {
  if (typeof document === 'undefined') return () => {};
  const point = resolveSuccessBurstPoint(options);

  confetti({
    particleCount: 80,
    spread: 72,
    startVelocity: 42,
    gravity: 1.1,
    ticks: 320,
    origin: {
      x: point.x / window.innerWidth,
      y: point.y / window.innerHeight
    },
    disableForReducedMotion: true,
    zIndex: 9998
  });

  let timerId: number | undefined;
  let burst: HTMLDivElement | undefined;

  if (options.label) {
    burst = document.createElement('div');
    burst.className = 'success-burst';
    burst.style.left = `${point.x}px`;
    burst.style.top = `${point.y}px`;
    const label = document.createElement('span');
    label.className = 'success-burst-label';
    label.textContent = options.label;
    burst.appendChild(label);
    document.body.appendChild(burst);
    timerId = window.setTimeout(() => burst!.remove(), 1900);
  }

  return () => {
    if (timerId !== undefined) window.clearTimeout(timerId);
    burst?.remove();
  };
}
