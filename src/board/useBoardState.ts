import { useEffect, useRef, useState } from 'react';
import { FULL_BOARD, type BoardState } from '../../shared/charset';
import { blankCells } from '../../shared/format';
import { getBoardState } from '../api/client';

const EMPTY: BoardState = {
  rows: FULL_BOARD.rows,
  cols: FULL_BOARD.cols,
  cells: blankCells(FULL_BOARD),
  source: 'main',
  text: '',
  updatedAt: 0,
};

/** Live board state: WebSocket push with automatic reconnect + polling fallback. */
export function useBoardState(): BoardState {
  const [state, setState] = useState<BoardState>(EMPTY);
  const wsOpen = useRef(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let reconnect: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => (wsOpen.current = true);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'board') setState(msg.state);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        wsOpen.current = false;
        if (!closed) reconnect = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    // Poll as a safety net while the socket is down.
    const poll = setInterval(async () => {
      if (wsOpen.current) return;
      try {
        const next = await getBoardState(null);
        if (!('unchanged' in next)) setState(next);
      } catch {
        /* server not up yet */
      }
    }, 2000);

    return () => {
      closed = true;
      clearTimeout(reconnect);
      clearInterval(poll);
      ws?.close();
    };
  }, []);

  return state;
}
