import { EventEmitter } from 'node:events';
import type { BoardState } from '../shared/charset.js';
import { CELL_COUNT, FULL_BOARD } from '../shared/charset.js';
import { formatToCells } from '../shared/format.js';
import { getConfig } from './config.js';

const MESSAGE_SECONDS = 60;

interface Display {
  source: 'main' | 'message';
  text: string;
  cells: string[];
  expiresAt: number | null;
}

class BoardStateMachine extends EventEmitter {
  private display: Display = {
    source: 'main',
    text: '',
    cells: new Array(CELL_COUNT).fill(' '),
    expiresAt: null,
  };
  private mainCache: { text: string; cells: string[] } = {
    text: '',
    cells: new Array(CELL_COUNT).fill(' '),
  };

  constructor() {
    super();
    setInterval(() => this.tick(), 2000);
  }

  get(): BoardState {
    return {
      rows: FULL_BOARD.rows,
      cols: FULL_BOARD.cols,
      cells: this.display.cells,
      source: this.display.source,
      text: this.display.text,
      updatedAt: Date.now(),
      expiresAt: this.display.expiresAt,
      sound: getConfig().sound,
    };
  }

  /** Re-broadcast current state (e.g. after a config change alters sound settings). */
  touch() {
    this.emit('change', this.get());
  }

  /** Called by the active main integration whenever it has fresh content. */
  setMain(text: string, cells?: string[]) {
    this.mainCache = { text, cells: cells ?? formatToCells(text) };
    if (this.display.source === 'main') {
      this.display = { source: 'main', text, cells: this.mainCache.cells, expiresAt: null };
      this.emit('change', this.get());
    }
  }

  /** Called by message integrations. Most recent message always wins. */
  showMessage(text: string) {
    this.display = {
      source: 'message',
      text,
      cells: formatToCells(text),
      expiresAt: Date.now() + MESSAGE_SECONDS * 1000,
    };
    this.emit('change', this.get());
  }

  private tick() {
    if (
      this.display.source === 'message' &&
      this.display.expiresAt !== null &&
      Date.now() >= this.display.expiresAt
    ) {
      this.display = {
        source: 'main',
        text: this.mainCache.text,
        cells: this.mainCache.cells,
        expiresAt: null,
      };
      this.emit('change', this.get());
    }
  }
}

export const board = new BoardStateMachine();
