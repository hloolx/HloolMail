import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const appFrameCSS = readFileSync('src/styles/app-frame.css', 'utf8');
const indexCSS = readFileSync('src/styles/index.css', 'utf8');
const layoutCSS = readFileSync('src/styles/layout.css', 'utf8');

function cssRule(source: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|})\\s*${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

describe('sidebar layout CSS', () => {
  it('offsets content with a sidebar shell gap instead of app-main padding', () => {
    const sidebarShell = compact(cssRule(layoutCSS, '.sidebar-shell'));
    const appMain = compact(cssRule(appFrameCSS, '.app-main'));

    expect(sidebarShell).toContain('flex: 0 0 var(--sidebar-shell-width);');
    expect(sidebarShell).toContain('width: var(--sidebar-shell-width);');
    expect(appMain).not.toContain('padding-left');
  });

  it('uses the compact newapi-style icon rail dimensions', () => {
    expect(indexCSS).toContain('--sidebar-width: 13rem;');
    expect(indexCSS).toContain('--sidebar-width-icon: 2.75rem;');
    expect(appFrameCSS).toContain('--sidebar-icon-shell-width: calc(var(--sidebar-width-icon) + 1rem + 2px);');
  });

  it('keeps collapsed nav items stable and centered', () => {
    const collapsedNavItem = compact(cssRule(layoutCSS, '.sidebar-collapsed .nav-item'));

    expect(collapsedNavItem).toContain('width: 2rem;');
    expect(collapsedNavItem).toContain('height: 2rem;');
    expect(collapsedNavItem).toContain('justify-content: center;');
    expect(collapsedNavItem).toContain('padding: 0;');
  });

  it('keeps long navigation scrollable in the expanded sidebar', () => {
    const sidebarNav = compact(cssRule(layoutCSS, '.sidebar-nav'));

    expect(sidebarNav).toContain('min-height: 0;');
    expect(sidebarNav).toContain('overflow-y: auto;');
  });
});
