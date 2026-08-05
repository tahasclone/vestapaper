import { useEffect, useState } from 'react';
import { FULL_BOARD, type BoardSize } from '../../shared/charset';
import { formatToCells } from '../../shared/format';

interface Options {
  /** ms each frame holds before advancing */
  holdMs?: number;
  /** Loop forever, or stop on the last frame. */
  loop?: boolean;
  size?: BoardSize;
}

/**
 * Drives a board through a scripted list of strings — the landing page's
 * demo content, rendered entirely client-side with no backend.
 *
 * Under prefers-reduced-motion it settles on the final frame immediately
 * rather than stepping, so the page never animates against the user's wishes.
 */
export function useSequence(frames: string[], { holdMs = 2600, loop = false, size = FULL_BOARD }: Options = {}) {
  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const [index, setIndex] = useState(reduce ? frames.length - 1 : 0);

  useEffect(() => {
    if (reduce || frames.length < 2) return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      if (i >= frames.length) {
        if (!loop) {
          clearInterval(id);
          return;
        }
        i = 0;
      }
      setIndex(i);
    }, holdMs);
    return () => clearInterval(id);
  }, [frames.length, holdMs, loop, reduce]);

  return formatToCells(frames[Math.min(index, frames.length - 1)], size);
}
