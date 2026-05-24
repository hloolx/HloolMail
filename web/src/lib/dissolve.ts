import { toPng } from 'html-to-image';

export interface DissolveOptions {
  duration?: number;
  blockSize?: number;
  direction?: 'up' | 'out' | 'random';
  fadeSpeed?: number;
}

interface Particle {
  x: number;
  y: number;
  color: string;
  vx: number;
  vy: number;
  delay: number;
}

const DEFAULTS: Required<DissolveOptions> = {
  duration: 500,
  blockSize: 4,
  direction: 'out',
  fadeSpeed: 1,
};

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export async function dissolveElement(
  target: HTMLElement,
  options?: DissolveOptions
): Promise<void> {
  const opts = { ...DEFAULTS, ...options };

  if (reducedMotion()) {
    target.style.visibility = 'hidden';
    return;
  }

  const dataUrl = await toPng(target, {
    pixelRatio: Math.min(window.devicePixelRatio, 2),
    cacheBust: true,
  });

  const rect = target.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio, 2);
  const cw = Math.ceil(rect.width * dpr);
  const ch = Math.ceil(rect.height * dpr);

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  canvas.style.cssText =
    `position:fixed;left:${rect.left}px;top:${rect.top}px;` +
    `width:${rect.width}px;height:${rect.height}px;` +
    `pointer-events:none;z-index:9999;`;

  const ctx = canvas.getContext('2d')!;

  const img = new Image();
  img.src = dataUrl;
  await new Promise<void>((resolve) => {
    if (img.complete) resolve();
    else img.onload = () => resolve();
  });
  ctx.drawImage(img, 0, 0, cw, ch);

  const imageData = ctx.getImageData(0, 0, cw, ch);
  const pixels = imageData.data;
  const { blockSize, direction } = opts;

  const particles: Particle[] = [];

  for (let y = 0; y < ch; y += blockSize) {
    for (let x = 0; x < cw; x += blockSize) {
      const cx = Math.min(x + Math.floor(blockSize / 2), cw - 1);
      const cy = Math.min(y + Math.floor(blockSize / 2), ch - 1);
      const i = (cy * cw + cx) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];

      if (a < 30) continue;

      let vx: number;
      let vy: number;
      if (direction === 'up') {
        vx = (Math.random() - 0.5) * 3;
        vy = -(Math.random() * 3 + 1);
      } else if (direction === 'out') {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3 + 1;
        vx = Math.cos(angle) * speed;
        vy = Math.sin(angle) * speed - 1;
      } else {
        vx = (Math.random() - 0.5) * 4;
        vy = (Math.random() - 0.5) * 4;
      }

      const noise = Math.sin(x * 0.1) * Math.cos(y * 0.1) * 0.5 + 0.5;
      const delay = noise * 0.4;

      particles.push({ x, y, color: `rgba(${r},${g},${b},${a / 255})`, vx, vy, delay });
    }
  }

  target.style.visibility = 'hidden';
  document.body.appendChild(canvas);

  const startTime = performance.now();
  const { duration, fadeSpeed } = opts;

  return new Promise<void>((resolve) => {
    function animate(now: number) {
      const elapsed = now - startTime;
      const globalProgress = Math.min(elapsed / duration, 1);

      ctx.clearRect(0, 0, cw, ch);

      for (const p of particles) {
        const rawProgress = (elapsed / duration - p.delay) / (1 - p.delay);
        const progress = Math.max(0, Math.min(rawProgress * fadeSpeed, 1));
        if (progress >= 1) continue;

        const alpha = 1 - progress;
        const scale = 1 - progress * 0.5;
        const currentX = p.x + p.vx * progress * 60;
        const currentY = p.y + p.vy * progress * 60;
        const size = blockSize * scale;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(currentX, currentY, size, size);
      }

      ctx.globalAlpha = 1;

      if (globalProgress < 1) {
        requestAnimationFrame(animate);
      } else {
        canvas.remove();
        resolve();
      }
    }

    requestAnimationFrame(animate);
  });
}

export async function dissolveContainer(
  container: HTMLElement,
  options?: DissolveOptions
): Promise<void> {
  return dissolveElement(container, { ...options, direction: 'up' });
}
