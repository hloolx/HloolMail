import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const layoutCSS = readFileSync('src/styles/layout.css', 'utf8');

function cssRule(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = layoutCSS.match(new RegExp(`(?:^|})\\s*${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

describe('sidebar layout CSS', () => {
  it('keeps the user card in a dedicated bottom row', () => {
    const sidebarInner = compact(cssRule('.sidebar-inner'));

    expect(sidebarInner).toContain('display: grid;');
    expect(sidebarInner).toContain('grid-template-rows: minmax(0, 1fr) auto;');
  });

  it('lets long navigation scroll without shrinking the user card', () => {
    const sidebarNav = compact(cssRule('.sidebar-nav'));
    const sidebarUserCard = compact(cssRule('.sidebar-user-card'));

    expect(sidebarNav).toContain('min-height: 0;');
    expect(sidebarNav).toContain('overflow-y: auto;');
    expect(sidebarUserCard).toContain('flex: 0 0 auto;');
  });
});
