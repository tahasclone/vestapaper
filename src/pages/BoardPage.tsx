import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SplitFlapBoard } from '../board/SplitFlapBoard';
import { useBoardState } from '../board/useBoardState';

const GEAR_HIDE_MS = 5000;

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10 4.09V4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08c.26.63.87 1.05 1.56 1.06H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z" />
    </svg>
  );
}

export function BoardPage() {
  const { cells } = useBoardState();
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
      <SplitFlapBoard cells={cells} />
      <Link
        to="/settings"
        className={`gear ${gearVisible ? '' : 'hidden'}`}
        aria-label="Settings"
        onMouseEnter={() => setGearVisible(true)}
      >
        <GearIcon />
      </Link>
    </div>
  );
}
