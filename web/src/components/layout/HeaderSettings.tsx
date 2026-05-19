import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Monitor, Moon, RefreshCw, SlidersHorizontal, Sun } from 'lucide-react';
import type { User } from '../../api';
import { api } from '../../api';
import { useText } from '../../locales';
import { useAppStore } from '../../store';
import type { Language, ThemeMode } from '../../store';
import { animateThemeSwitch } from '../../lib/theme';

type VersionInfo = {
  version: string;
  commit: string;
  buildTime: string;
};

type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseURL: string;
};

export function HeaderSettings({ user }: { user?: User }) {
  const { theme, setTheme, language, setLanguage } = useAppStore();
  const text = useText();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const isAdmin = user?.role === 'admin';

  const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: 'system', label: text.settings.system, icon: Monitor },
    { value: 'light', label: text.settings.light, icon: Sun },
    { value: 'dark', label: text.settings.dark, icon: Moon }
  ];

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeByKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeByKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeByKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !isAdmin || versionInfo) return;
    api<VersionInfo>('/api/version', { method: 'GET' })
      .then(setVersionInfo)
      .catch(() => {});
  }, [open, isAdmin, versionInfo]);

  const checkUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      const result = await api<UpdateInfo>('/api/version/check', { method: 'GET' });
      setUpdateInfo(result);
    } catch {
      // ignore check failures
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  return (
    <div className="header-settings" ref={menuRef}>
      <button className={`header-settings-btn ${open ? 'header-settings-btn-active' : ''}`} title={text.settings.open} aria-label={text.settings.open} onClick={() => setOpen((value) => !value)}>
        <SlidersHorizontal size={16} />
      </button>
      {open && (
        <div className="header-settings-popover" role="menu" aria-label={text.settings.aria}>
          <div className="settings-menu">
            <div className="settings-row">
              <span className="settings-label">{text.settings.theme}</span>
              <div className="theme-toggle-group" role="group" aria-label={text.settings.theme}>
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.value}
                      className={`theme-choice ${theme === option.value ? 'theme-choice-active' : ''}`}
                      type="button"
                      title={option.label}
                      aria-label={option.label}
                      aria-pressed={theme === option.value}
                      onClick={(event) => animateThemeSwitch(event, option.value, setTheme)}
                    >
                      <Icon size={16} />
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="settings-row">
              <span className="settings-label">{text.settings.language}</span>
              <span className="settings-select-shell">
                <select className="settings-select" value={language} aria-label={text.settings.language} onChange={(event) => setLanguage(event.target.value as Language)}>
                  <option value="zh-CN">{text.settings.zhCN}</option>
                  <option value="en-US">{text.settings.enUS}</option>
                </select>
                <ChevronDown className="settings-select-icon" size={15} aria-hidden />
              </span>
            </label>
            {isAdmin && (
              <div className="settings-row">
                <span className="settings-label">{text.settings.version}</span>
                <span className="settings-version-row">
                  <span className="settings-version-value">
                    {versionInfo ? `v${versionInfo.version}` : '...'}
                  </span>
                  <button
                    className={`settings-version-refresh ${checkingUpdate ? 'settings-version-refresh-spin' : ''}`}
                    title={text.settings.checkUpdate}
                    aria-label={text.settings.checkUpdate}
                    disabled={checkingUpdate}
                    onClick={checkUpdate}
                  >
                    <RefreshCw size={12} />
                  </button>
                  {updateInfo?.updateAvailable && (
                    <a
                      className="settings-version-update"
                      href={updateInfo.releaseURL || 'https://github.com/hloolx/HloolMail/releases'}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {text.settings.updateAvailable}
                    </a>
                  )}
                </span>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
