export const MOBILE_NAVIGATION_QUERY = '(max-width: 1023px)';

export function isMobileNavigationViewport() {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_NAVIGATION_QUERY).matches;
}
