import { addBreadcrumb, captureMessage, setMonitoringTag } from './monitoring';

export type MetricName = 'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB';

type VitalEntry = {
  name: MetricName;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  id: string;
};

const THRESHOLDS: Record<MetricName, { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 }
};

const reported = new Set<MetricName>();

function rate(name: MetricName, value: number): VitalEntry['rating'] {
  const threshold = THRESHOLDS[name];
  if (value <= threshold.good) return 'good';
  if (value >= threshold.poor) return 'poor';
  return 'needs-improvement';
}

function reportVital(entry: VitalEntry): void {
  if (reported.has(entry.name)) return;
  reported.add(entry.name);

  const precision = entry.name === 'CLS' ? 3 : 0;
  setMonitoringTag(`vitals.${entry.name}`, entry.value.toFixed(precision));
  setMonitoringTag(`vitals.${entry.name}.rating`, entry.rating);
  addBreadcrumb({
    category: 'vitals',
    message: `${entry.name}=${entry.value.toFixed(2)} (${entry.rating})`,
    level: entry.rating === 'poor' ? 'warning' : 'info',
    data: { id: entry.id, name: entry.name, value: entry.value, rating: entry.rating }
  });

  if (entry.rating === 'poor') {
    captureMessage(`Slow Web Vital: ${entry.name}=${entry.value.toFixed(2)}`, 'warning');
  }
}

function observeLCP(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    let lastValue = 0;
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) lastValue = last.startTime;
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });

    const finalize = () => {
      if (lastValue > 0) {
        reportVital({ name: 'LCP', value: lastValue, rating: rate('LCP', lastValue), id: 'lcp' });
      }
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') finalize();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
  } catch {
    // Unsupported entry type.
  }
}

function observeINP(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    const observer = new PerformanceObserver((list) => {
      let worst = 0;
      for (const entry of list.getEntries()) {
        const duration = (entry as PerformanceEventTiming).duration;
        if (duration > worst) worst = duration;
      }
      if (worst > 0) {
        reportVital({ name: 'INP', value: worst, rating: rate('INP', worst), id: 'inp' });
      }
    });
    observer.observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit & {
      durationThreshold: number;
    });
  } catch {
    // Unsupported entry type.
  }
}

function observeCLS(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    let clsValue = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LayoutShift[]) {
        if (!entry.hadRecentInput) clsValue += entry.value;
      }
    });
    observer.observe({ type: 'layout-shift', buffered: true });

    const finalize = () => {
      reportVital({ name: 'CLS', value: clsValue, rating: rate('CLS', clsValue), id: 'cls' });
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') finalize();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
  } catch {
    // Unsupported entry type.
  }
}

function observePaintAndTTFB(): void {
  if (typeof performance === 'undefined' || !performance.getEntriesByType) return;
  try {
    for (const entry of performance.getEntriesByType('paint')) {
      if (entry.name === 'first-contentful-paint') {
        reportVital({ name: 'FCP', value: entry.startTime, rating: rate('FCP', entry.startTime), id: 'fcp' });
      }
    }

    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigation) {
      reportVital({
        name: 'TTFB',
        value: navigation.responseStart,
        rating: rate('TTFB', navigation.responseStart),
        id: 'ttfb'
      });
    }
  } catch {
    // Performance APIs are best-effort only.
  }
}

interface PerformanceEventTiming extends PerformanceEntry {
  duration: number;
  processingStart: number;
}

interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

export function startWebVitals(): void {
  if (typeof window === 'undefined') return;
  observePaintAndTTFB();
  observeLCP();
  observeCLS();
  observeINP();
}
