// Colour schemes on offer for the canopy: one colour per cell, left tip to
// right tip.

export type CanopyColorId = 'blue' | 'red' | 'yellow' | 'green' | 'orange' | 'purple' | 'black' | 'rainbow';

const W = 0xf2f2ee;

export const CANOPY_COLORS: Record<CanopyColorId, { name: string; cells: number[] }> = {
  blue: { name: 'Bleu et blanc', cells: [0x18305c, 0x2a6fd0, 0x2a6fd0, W, W, W, 0x2a6fd0, 0x2a6fd0, 0x18305c] },
  red: { name: 'Rouge et noir', cells: [0x17181c, 0xc9382c, 0xc9382c, W, W, W, 0xc9382c, 0xc9382c, 0x17181c] },
  yellow: { name: 'Jaune et noir', cells: [0x17181c, 0xf2c014, 0xf2c014, 0xf2c014, 0x17181c, 0xf2c014, 0xf2c014, 0xf2c014, 0x17181c] },
  green: { name: 'Vert fluo', cells: [0x1d3b2a, 0x9be22d, 0x9be22d, W, 0x9be22d, W, 0x9be22d, 0x9be22d, 0x1d3b2a] },
  orange: { name: 'Orange et blanc', cells: [0xe85a12, 0xe85a12, W, 0xe85a12, 0xe85a12, 0xe85a12, W, 0xe85a12, 0xe85a12] },
  purple: { name: 'Violet et rose', cells: [0x3b1d5c, 0x7d3cc8, 0xe0509a, 0x7d3cc8, W, 0x7d3cc8, 0xe0509a, 0x7d3cc8, 0x3b1d5c] },
  black: { name: 'Noir', cells: [0x1c1d21, 0x26272c, 0x1c1d21, 0x26272c, 0x8a8d94, 0x26272c, 0x1c1d21, 0x26272c, 0x1c1d21] },
  rainbow: {
    name: 'Arc-en-ciel',
    cells: [0xd8281e, 0xf2781e, 0xf2c014, 0x4cb648, 0x2a9fd6, 0x2a5fd0, 0x7a3fc1, 0xd23f8c, 0xd8281e],
  },
};

export const isCanopyColor = (id: unknown): id is CanopyColorId => typeof id === 'string' && id in CANOPY_COLORS;
