import { beforeEach, describe, expect, it, vi } from 'vitest';

async function importFreshStore() {
  vi.resetModules();
  return import('./store');
}

describe('app store sidebar defaults', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = '';
  });

  it('defaults the sidebar to collapsed for admins without a saved preference', async () => {
    const { useAppStore } = await importFreshStore();

    expect(useAppStore.getState().sidebarCollapsed).toBe(false);

    useAppStore.getState().applySidebarRoleDefault('admin');

    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    expect(localStorage.getItem('hlool-mail.sidebarCollapsed')).toBeNull();
  });

  it('keeps an explicit saved sidebar preference', async () => {
    localStorage.setItem('hlool-mail.sidebarCollapsed', 'false');
    const { useAppStore } = await importFreshStore();

    useAppStore.getState().applySidebarRoleDefault('admin');

    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
  });
});
