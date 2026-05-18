import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useText } from '../../locales';
import { useAppStore } from '../../store';
import { AppLogo } from '../shared/AppLogo';
import { HeaderSettings } from './HeaderSettings';
import { NotificationBell } from './NotificationBell';

export function Topbar() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore();
  const text = useText();
  const sidebarTitle = sidebarCollapsed ? text.nav.expandSidebar : text.nav.collapseSidebar;

  return (
    <header className="topbar">
      <div className="app-header-inner">
        <div className="app-header-left">
          <button className="app-header-trigger" title={sidebarTitle} aria-label={sidebarTitle} onClick={toggleSidebar}>
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <div className="app-header-brand" aria-label="HLOOL Mail">
            <span className="app-header-brand-mark">
              <AppLogo />
            </span>
            <span className="app-header-brand-name">HLOOL Mail</span>
          </div>
        </div>

        <div className="app-header-main">
          <NotificationBell />
          <HeaderSettings />
        </div>
      </div>
    </header>
  );
}
