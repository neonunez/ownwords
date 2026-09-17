import type { MouseEvent } from 'react';
import { Icon, type IconName } from '../core/Icon';

export interface TabItem {
  key: string;
  label: string;
  icon: IconName;
  href: string;
}

export interface TabBarProps {
  tabs: readonly TabItem[];
  activeKey: string;
  /** Called with the tab's href; the shell decides how to navigate. */
  onSelect: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
  /** Names the bar, so two bars never sound alike: "Maintain", "Learn". */
  label: string;
}

/**
 * The daily-action bar. Tabs are real links, so they carry a URL, open in a
 * new tab on a middle click and announce the current page. The bar clears the
 * bottom safe area, and each tab keeps a 44px target.
 */
export function TabBar({ tabs, activeKey, onSelect, label }: TabBarProps) {
  return (
    <nav
      aria-label={label}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${tabs.length}, 1fr)`,
        height: 'calc(var(--tabbar-h) + var(--safe-bottom))',
        paddingBottom: 'var(--safe-bottom)',
        background: 'var(--tabbar-bg)',
        backdropFilter: 'var(--blur-bar)',
        WebkitBackdropFilter: 'var(--blur-bar)',
        borderTop: '1px solid var(--border-1)',
      }}
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <a
            key={tab.key}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            onClick={(event) => onSelect(tab.href, event)}
            style={{
              minHeight: 44,
              display: 'grid',
              justifyItems: 'center',
              alignContent: 'center',
              gap: 3,
              color: active ? 'var(--accent)' : 'var(--fg-3)',
              textDecoration: 'none',
              transition: 'color var(--motion-fast)',
            }}
          >
            <span
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 44,
                height: 26,
                borderRadius: 99,
                background: active ? 'var(--accent-soft)' : 'transparent',
                transition:
                  'background var(--motion-base) var(--ease-out), transform var(--motion-base) var(--ease-spring)',
                transform: active ? 'translateY(-1px)' : 'none',
              }}
            >
              <Icon name={tab.icon} size={22} strokeWidth={active ? 2 : 1.75} />
            </span>
            <span
              style={{
                font: 'var(--type-caption)',
                fontWeight: active ? 600 : 500,
                fontSize: '.6875rem',
                letterSpacing: '.01em',
              }}
            >
              {tab.label}
            </span>
          </a>
        );
      })}
    </nav>
  );
}
