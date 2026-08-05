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

export const ROWS = 6;
export const COLS = 22;
export const CELL_COUNT = ROWS * COLS;

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
  cells: string[]; // length CELL_COUNT, each entry is a member of CHARSET
  source: 'main' | 'message';
  text: string;
  updatedAt: number;
}
