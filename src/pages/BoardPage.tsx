import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SplitFlapBoard } from '../board/SplitFlapBoard';
import { useBoardState } from '../board/useBoardState';
import { configureSound } from '../board/sound';

const GEAR_HIDE_MS = 5000;

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10 4.09V4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08c.26.63.87 1.05 1.56 1.06H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 10.5 12 3.5l9 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M9.75 20v-5.5h4.5V20" />
    </svg>
  );
}

export function BoardPage() {
  const { token } = useParams<{ token: string }>();
  const { state } = useBoardState(token ?? null);
  const { cells, rows, cols, sound } = state;

  useEffect(() => {
    configureSound(sound?.enabled ?? false, sound?.volume ?? 0.4);
  }, [sound?.enabled, sound?.volume]);

  // The wallpaper fills the viewport with no scrollbars; other pages scroll.
  useEffect(() => {
    document.body.classList.add('board-locked');
    return () => document.body.classList.remove('board-locked');
  }, []);
  const [gearVisible, setGearVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const poke = () => {
      setGearVisible(true);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setGearVisible(false), GEAR_HIDE_MS);
    };
    poke();
    window.addEventListener('mousemove', poke);
    return () => {
      window.removeEventListener('mousemove', poke);
      clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <div className="wall">
      <div className="board-stage">
        <SplitFlapBoard cells={cells} rows={rows} cols={cols} />
      </div>
      {/* Both fade out with the board so the wallpaper stays clean. */}
      <div
        className={`board-nav ${gearVisible ? '' : 'hidden'}`}
        onMouseEnter={() => setGearVisible(true)}
      >
        <Link to="/" className="gear" aria-label="Home" title="Home">
          <HomeIcon />
        </Link>
        <Link to="/app" className="gear" aria-label="Settings" title="Settings">
          <GearIcon />
        </Link>
      </div>
    </div>
  );
}
