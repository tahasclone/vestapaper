import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { logout } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { SplitFlapBoard } from '../board/SplitFlapBoard';
import { formatToCells } from '../../shared/format';

const WORDMARK_SIZE = { rows: 1, cols: 19 };
const WORDMARK_CELLS = formatToCells('SOLARIS WALLPAPER {yellow}', WORDMARK_SIZE);

const TABS = [
  ['/app', 'SETTINGS'],
  ['/app/support', 'SETUP & SUPPORT'],
] as const;

/** Shared chrome for the signed-in pages, so they cannot drift apart. */
export function AppFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const { user, board } = useAuth();
  const { pathname } = useLocation();

  return (
    <div className="settings">
      <div className="settings-inner">
        <div className="app-topbar">
          {board ? (
            <Link to={`/b/${board.token}`} className="back-link" style={{ marginBottom: 0 }}>
              ← BACK TO BOARD
            </Link>
          ) : (
            <span />
          )}
          {user && (
            <span className="whoami">
              {user.email}
              <button
                className="linkish"
                onClick={async () => {
                  await logout().catch(() => {});
                  window.location.href = '/';
                }}
              >
                SIGN OUT
              </button>
            </span>
          )}
        </div>

        <div className="wordmark" aria-hidden>
          <SplitFlapBoard cells={WORDMARK_CELLS} {...WORDMARK_SIZE} maxCellH={24} bare />
        </div>

        <nav className="app-tabs">
          {TABS.map(([to, label]) => (
            <Link key={to} to={to} className={pathname === to ? 'on' : ''}>
              {label}
            </Link>
          ))}
        </nav>

        <h1>{title}</h1>
        <p className="subtitle">{subtitle}</p>

        {children}
      </div>
    </div>
  );
}
