/**
 * Vitest 全局 setup。
 *
 * 职责：补齐 jsdom 缺失但被业务代码依赖的浏览器 API，使测试无需在每个文件里重复 mock。
 * 注意：setupFiles 运行在独立的执行上下文，不能使用 vitest 的 beforeEach/afterEach hooks。
 *       跨用例清理由各测试文件自行负责（或通过 globals afterEach）。
 */

// ── matchMedia（store / theme / feedback 等用到） ─────────────────────────
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

// ── requestAnimationFrame（framer-motion / dissolve 等用到） ────────────
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
}

// ── ResizeObserver（部分布局组件用到） ─────────────────────────────────
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// ── IntersectionObserver ───────────────────────────────────────────────
if (typeof globalThis.IntersectionObserver === 'undefined') {
  class IntersectionObserverStub {
    root = null;
    rootMargin = '';
    thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  globalThis.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver;
}

// 注意：不要在此文件使用 vitest 的 beforeEach/afterEach hooks，
// setupFiles 运行在独立上下文。跨用例清理请在各测试文件内完成。
