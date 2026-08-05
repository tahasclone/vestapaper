import { useEffect, useRef, useState } from 'react';
import { CELL_COUNT, type BoardState } from '../../shared/charset';

const EMPTY: BoardState = {
  cells: new Array(CELL_COUNT).fill(' '),
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
        const res = await fetch('/api/board-state');
        if (res.ok) setState(await res.json());
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
