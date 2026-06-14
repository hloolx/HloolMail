import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOBILE_NAVIGATION_QUERY, isMobileNavigationViewport } from './navigationBreakpoint';

describe('navigation breakpoint', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('uses the same breakpoint query as the stylesheet', () => {
    expect(MOBILE_NAVIGATION_QUERY).toBe('(max-width: 1023px)');
  });

  it('returns the current matchMedia result', () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === MOBILE_NAVIGATION_QUERY,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    expect(isMobileNavigationViewport()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(MOBILE_NAVIGATION_QUERY);
  });
});
