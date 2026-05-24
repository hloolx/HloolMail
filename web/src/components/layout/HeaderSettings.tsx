import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ExternalLink, Monitor, Moon, RefreshCw, SlidersHorizontal, Sparkles, Sun } from 'lucide-react';
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
  const [updateCheckFailed, setUpdateCheckFailed] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const isAdmin = user?.role === 'admin';
  const currentVersion = versionInfo?.version || updateInfo?.currentVersion;
  const currentVersionLabel = currentVersion ? `v${currentVersion}` : '...';
  const latestVersionLabel = updateInfo?.latestVersion ? `v${updateInfo.latestVersion}` : '';
  const updateStatus = updateCheckFailed ? 'error' : updateInfo?.updateAvailable ? 'available' : updateInfo ? 'current' : 'idle';

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
    if (!isAdmin) return;

    setCheckingUpdate(true);
    setUpdateCheckFailed(false);
    try {
      const result = await api<UpdateInfo>('/api/version/check', { method: 'GET' });
      setUpdateInfo(result);
    } catch {
      setUpdateCheckFailed(true);
    } finally {
      setCheckingUpdate(false);
    }
  }, [isAdmin]);

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
              <>
                <div className="settings-row">
                  <span className="settings-label">{text.settings.version}</span>
                  <div className="settings-version-control">
                    <div className="settings-version-row">
                      <span className="settings-version-value">{currentVersionLabel}</span>
                      <button
                        className="settings-version-refresh"
                        title={text.settings.checkUpdate}
                        aria-label={text.settings.checkUpdate}
                        disabled={checkingUpdate}
                        onClick={checkUpdate}
                      >
                        <RefreshCw className={checkingUpdate ? 'settings-version-refresh-spin' : undefined} size={12} />
                      </button>
                    </div>
                    {updateStatus !== 'idle' && (
                      <div className={`settings-version-card settings-version-card-${updateStatus}`}>
                        <span className="settings-version-card-icon" aria-hidden>
                          {updateStatus === 'available' ? <Sparkles size={14} /> : updateStatus === 'error' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
                        </span>
                        <span className="settings-version-card-copy">
                          <strong>
                            {updateStatus === 'available'
                              ? text.settings.updateReadyTitle.replace('{version}', latestVersionLabel)
                              : updateStatus === 'error'
                                ? text.settings.updateCheckFailed
                                : text.settings.updateCurrentTitle}
                          </strong>
                        </span>
                        {updateStatus === 'available' && (
                          <a
                            className="settings-version-card-action"
                            href={updateInfo?.releaseURL || 'https://github.com/hloolx/HloolMail/releases'}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <span>{text.settings.viewRelease}</span>
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
