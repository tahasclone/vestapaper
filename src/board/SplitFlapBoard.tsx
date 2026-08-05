import { useLayoutEffect, useRef, useState } from 'react';
import { SplitFlapCell } from './SplitFlapCell';

// stagger: ripple left-to-right with a slight top-down skew
const COL_STAGGER_MS = 26;
const ROW_STAGGER_MS = 9;

// Geometry constants, kept in sync with .board / .board-grid in index.css:
// cell width is 0.74 * cell height; gaps are 0.1 / 0.14 of cell height;
// bezel padding totals 1.2 horizontally and 1.1 vertically.
const CELL_ASPECT = 0.74;
const GAP_X = 0.1;
const GAP_Y = 0.14;
const PAD_X = 1.2;
const PAD_Y = 1.1;

interface Props {
  cells: string[];
  rows: number;
  cols: number;
  /** Clamp so a board in a large container doesn't grow absurdly. */
  maxCellH?: number;
  /** Drop the bezel — for inline uses like the wordmark. */
  bare?: boolean;
}

/**
 * Sizes itself to its CONTAINER (not the viewport), so the same component
 * serves the full-screen wallpaper board and the small landing-page hero.
 * Give it a parent with a definite width and height.
 */
export function SplitFlapBoard({ cells, rows, cols, maxCellH, bare }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState({ w: 30, h: 40 });

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const padX = bare ? 0 : PAD_X;
    const padY = bare ? 0 : PAD_Y;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const hFromWidth = width / (cols * (CELL_ASPECT + GAP_X) + padX);
      const hFromHeight = height / (rows * (1 + GAP_Y) + padY);
      let h = Math.floor(Math.min(hFromWidth, hFromHeight));
      if (maxCellH) h = Math.min(h, maxCellH);
      h = Math.max(8, h);
      setCell({ w: Math.floor(h * CELL_ASPECT), h });
    };
    measure();
    // ResizeObserver rather than window.resize: also catches container and
    // zoom changes, which the old viewport-based measurement missed.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows, cols, maxCellH, bare]);

  return (
    <div className="board-fit" ref={boxRef}>
      <div
        className={bare ? 'board bare' : 'board'}
        style={
          {
            '--cell-w': `${cell.w}px`,
            '--cell-h': `${cell.h}px`,
            '--cols': cols,
          } as React.CSSProperties
        }
      >
        <div className="board-grid">
          {cells.map((char, i) => (
            <SplitFlapCell
              key={i}
              index={i}
              target={char}
              delayMs={(i % cols) * COL_STAGGER_MS + Math.floor(i / cols) * ROW_STAGGER_MS}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
