import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Monitor, Moon, SlidersHorizontal, Sun } from 'lucide-react';
import { useText } from '../../locales';
import { useAppStore } from '../../store';
import type { Language, ThemeMode } from '../../store';
import { animateThemeSwitch } from '../../lib/theme';

export function HeaderSettings() {
  const { theme, setTheme, language, setLanguage } = useAppStore();
  const text = useText();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
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
          </div>

        </div>
      )}
    </div>
  );
}
