import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Globe, FileText, Settings, ClipboardList } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import styles from './AppShell.module.css';

const NAV_LINKS: Array<{ to: string; label: string; icon: LucideIcon; end?: true }> = [
  { to: '/',             label: 'Dashboard',   icon: LayoutDashboard, end: true },
  { to: '/sources',      label: 'Sources',     icon: Globe },
  { to: '/applications', label: 'Applications', icon: ClipboardList },
  { to: '/cv',           label: 'CV',          icon: FileText },
  { to: '/settings',     label: 'Settings',    icon: Settings },
];

/**
 * App shell — top nav bar with logo and page links.
 * The pipeline sidebar lives inside Dashboard only.
 */
export function AppShell() {
  return (
    <div className={styles.shell}>
      <header className={styles.topNav} role="banner">
        <span className={styles.logo}>job-me</span>
        <nav className={styles.nav} aria-label="Main navigation">
          {NAV_LINKS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              {...(end ? { end: true } : {})}
              id={`nav-${label.toLowerCase()}`}
              className={({ isActive }) =>
                `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
              }
              aria-label={label}
            >
              <Icon size={15} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
