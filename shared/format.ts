import {
  CHARSET,
  CHAR_INDEX,
  COLOR_TOKENS,
  FULL_BOARD,
  cellCount,
  type BoardSize,
} from './charset.js';

const TOKEN_RE = new RegExp(
  `(${COLOR_TOKENS.map((t) => t.replace(/[{}]/g, '\\$&')).join('|')})`,
  'gi',
);

// Characters we can substitute rather than drop.
const SUBSTITUTES: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  '*': ' ',
  '_': ' ',
  '`': "'",
  '[': '(',
  ']': ')',
  '\t': ' ',
};

/** Turn raw text (may contain {red}-style tokens) into an array of board cells. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const parts = text.split(TOKEN_RE);
  for (const part of parts) {
    if (!part) continue;
    const lower = part.toLowerCase();
    if ((COLOR_TOKENS as readonly string[]).includes(lower)) {
      out.push(lower);
      continue;
    }
    for (let raw of part.split('')) {
      raw = SUBSTITUTES[raw] ?? raw;
      for (const ch of raw.toUpperCase().split('')) {
        if (ch === '\n') out.push('\n');
        else if (CHAR_INDEX.has(ch)) out.push(ch);
        // silently drop anything the drum can't show
      }
    }
  }
  return out;
}

/** Greedy word-wrap a token stream into lines of <= cols cells. */
function wrap(tokens: string[], cols: number): string[][] {
  const lines: string[][] = [];
  let line: string[] = [];
  let word: string[] = [];

  const pushWord = () => {
    if (!word.length) return;
    if (word.length > cols) word = word.slice(0, cols);
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= cols) line = [...line, ' ', ...word];
    else {
      lines.push(line);
      line = word;
    }
    word = [];
  };

  for (const t of tokens) {
    if (t === '\n') {
      pushWord();
      lines.push(line);
      line = [];
    } else if (t === ' ') {
      pushWord();
    } else {
      word.push(t);
    }
  }
  pushWord();
  if (line.length) lines.push(line);
  return lines;
}

/**
 * Format text into a full rows x cols cell grid: wrapped, truncated with an
 * ellipsis if too long, centered horizontally and vertically.
 */
export function formatToCells(text: string, size: BoardSize = FULL_BOARD): string[] {
  const { rows, cols } = size;
  let lines = wrap(tokenize(text), cols);

  if (lines.length > rows) {
    lines = lines.slice(0, rows);
    const last = lines[rows - 1];
    while (last.length > cols - 3) last.pop();
    last.push('.', '.', '.');
  }

  const cells: string[] = new Array(cellCount(size)).fill(' ');
  const rowOffset = Math.floor((rows - lines.length) / 2);
  lines.forEach((line, i) => {
    const row = rowOffset + i;
    const colOffset = Math.floor((cols - line.length) / 2);
    line.forEach((t, j) => {
      cells[row * cols + colOffset + j] = t;
    });
  });
  return cells;
}

/** Left-aligned variant used by layouts that compose their own lines. */
export function linesToCells(lines: string[][], size: BoardSize = FULL_BOARD): string[] {
  const { rows, cols } = size;
  const cells: string[] = new Array(cellCount(size)).fill(' ');
  lines.slice(0, rows).forEach((line, row) => {
    line.slice(0, cols).forEach((t, col) => {
      if (CHAR_INDEX.has(t)) cells[row * cols + col] = t;
    });
  });
  return cells;
}

export function centerLine(tokens: string[], cols: number = FULL_BOARD.cols): string[] {
  const pad = Math.max(0, Math.floor((cols - tokens.length) / 2));
  return [...new Array(pad).fill(' '), ...tokens];
}

/** A blank grid of the given size. */
export function blankCells(size: BoardSize = FULL_BOARD): string[] {
  return new Array(cellCount(size)).fill(' ');
}
