import { useCallback, useEffect, useRef, useState } from 'react';
import { FULL_BOARD, type BoardState } from '../../shared/charset';
import { blankCells } from '../../shared/format';
import { BOARD_POLL_MS, getBoardState, isUnchanged } from '../api/client';

const EMPTY: BoardState = {
  rows: FULL_BOARD.rows,
  cols: FULL_BOARD.cols,
  cells: blankCells(FULL_BOARD),
  source: 'main',
  text: '',
  updatedAt: 0,
  revision: 0,
};

/** A gap this long between polls means the machine slept or the tab was frozen. */
const STALL_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Polls the board state. Deliberately does not trust setInterval: a wallpaper
 * webview is offscreen most of the time and its timers get throttled, so this
 * also polls on visibility/focus/online events and runs a stall watchdog.
 */
export function useBoardState(token: string | null): { state: BoardState; error: boolean } {
  const [state, setState] = useState<BoardState>(EMPTY);
  const [error, setError] = useState(false);

  const revision = useRef(0);
  const lastPollAt = useRef(Date.now());
  const backoff = useRef(0);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const expiryTimer = useRef<ReturnType<typeof setTimeout>>();

  const poll = useCallback(
    async (force = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      lastPollAt.current = Date.now();
      try {
        const next = await getBoardState(token, force ? undefined : revision.current || undefined);
        if (!isUnchanged(next)) {
          revision.current = next.revision ?? 0;
          setState(next);
        }
        setError(false);
        backoff.current = 0;
      } catch {
        setError(true);
        // Back off so a cold-starting server isn't hammered.
        backoff.current = Math.min(
          backoff.current ? backoff.current * 2 : BOARD_POLL_MS,
          MAX_BACKOFF_MS,
        );
      } finally {
        inFlight.current = false;
      }
    },
    [token],
  );

  // Steady-state loop, rescheduled after each attempt so backoff applies.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      await poll();
      if (stopped) return;
      timer.current = setTimeout(tick, backoff.current || BOARD_POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer.current);
    };
  }, [poll]);

  // Re-sync on any signal that we may have missed time.
  useEffect(() => {
    const wake = () => {
      const stalled = Date.now() - lastPollAt.current > STALL_MS;
      // After a stall, drop the revision so we get a full state back rather
      // than trusting a counter that may be out of date.
      if (stalled) revision.current = 0;
      void poll(stalled);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') wake();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);

    // Watchdog for the case where nothing fires at all.
    const watchdog = setInterval(() => {
      if (Date.now() - lastPollAt.current > STALL_MS) wake();
    }, 10_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      clearInterval(watchdog);
    };
  }, [poll]);

  // When a message override is showing, poll again the moment it lapses so the
  // flip back is crisp instead of up to one interval late.
  useEffect(() => {
    clearTimeout(expiryTimer.current);
    if (!state.expiresAt) return;
    const delay = state.expiresAt - Date.now() + 250;
    if (delay <= 0 || delay > 5 * 60_000) return;
    expiryTimer.current = setTimeout(() => void poll(true), delay);
    return () => clearTimeout(expiryTimer.current);
  }, [state.expiresAt, poll]);

  return { state, error };
}
