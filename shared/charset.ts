// The character "ROM" of the board. Flip animations cycle through this
// sequence in order, wrapping around, exactly like the physical drum.
export const COLOR_TOKENS = [
  '{red}',
  '{orange}',
  '{yellow}',
  '{green}',
  '{blue}',
  '{violet}',
  '{white}',
  '{black}',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

export const CHARSET: string[] = [
  ' ',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...'1234567890'.split(''),
  ...'!@#$()-+&=;:\'"%,./?°'.split(''),
  ...COLOR_TOKENS,
];

export const CHAR_INDEX = new Map(CHARSET.map((c, i) => [c, i]));

export interface BoardSize {
  rows: number;
  cols: number;
}

/** The real Vestaboard geometry — what every user's board uses. */
export const FULL_BOARD: BoardSize = { rows: 6, cols: 22 };

/** Small board for the landing-page hero. */
export const HERO_BOARD: BoardSize = { rows: 3, cols: 14 };

export const cellCount = (size: BoardSize) => size.rows * size.cols;

export const ROWS = FULL_BOARD.rows;
export const COLS = FULL_BOARD.cols;
export const CELL_COUNT = cellCount(FULL_BOARD);

export const COLOR_HEX: Record<ColorToken, string> = {
  '{red}': '#d63c30',
  '{orange}': '#e07a2f',
  '{yellow}': '#e5b53a',
  '{green}': '#3d9a46',
  '{blue}': '#3672c9',
  '{violet}': '#9b3fc0',
  '{white}': '#e8e6e1',
  '{black}': '#141414',
};

export interface BoardState {
  rows: number;
  cols: number;
  cells: string[]; // length rows*cols, each entry is a member of CHARSET
  source: 'main' | 'message';
  text: string;
  updatedAt: number;
  /** When a message override lapses, so the client can re-poll exactly then. */
  expiresAt?: number | null;
  /** Monotonic counter, bumped on every content change, for conditional polling. */
  revision?: number;
  sound?: { enabled: boolean; volume: number };
}
