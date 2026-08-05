import { useLayoutEffect, useState } from 'react';
import { COLS, ROWS } from '../../shared/charset';
import { SplitFlapCell } from './SplitFlapCell';

// stagger: ripple left-to-right with a slight top-down skew
const COL_STAGGER_MS = 26;
const ROW_STAGGER_MS = 9;

function useCellSize() {
  const [size, setSize] = useState({ w: 40, h: 54 });
  useLayoutEffect(() => {
    const measure = () => {
      const availW = window.innerWidth * 0.9;
      const availH = window.innerHeight * 0.86;
      // horizontal footprint per cell: width + gap(0.1h); bezel padding ~1.2h wide, 1.1h tall
      const hFromWidth = availW / (COLS * (0.74 + 0.1) + 1.2);
      const hFromHeight = availH / (ROWS * (1 + 0.14) + 1.1);
      const h = Math.floor(Math.min(hFromWidth, hFromHeight));
      setSize({ w: Math.floor(h * 0.74), h });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return size;
}

export function SplitFlapBoard({ cells }: { cells: string[] }) {
  const { w, h } = useCellSize();
  return (
    <div
      className="board"
      style={{ '--cell-w': `${w}px`, '--cell-h': `${h}px` } as React.CSSProperties}
    >
      <div className="board-grid">
        {cells.map((char, i) => (
          <SplitFlapCell
            key={i}
            index={i}
            target={char}
            delayMs={(i % COLS) * COL_STAGGER_MS + Math.floor(i / COLS) * ROW_STAGGER_MS}
          />
        ))}
      </div>
    </div>
  );
}
