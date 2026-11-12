// Colour schemes on offer for the canopy: one colour per cell, left tip to
// right tip. Named in T.setup.colors.

export type CanopyColorId = 'blue' | 'red' | 'yellow' | 'green' | 'orange' | 'purple' | 'black' | 'rainbow';

const W = 0xf2f2ee;

export const CANOPY_COLORS: Record<CanopyColorId, { cells: number[] }> = {
  blue: { cells: [0x18305c, 0x2a6fd0, 0x2a6fd0, W, W, W, 0x2a6fd0, 0x2a6fd0, 0x18305c] },
  red: { cells: [0x17181c, 0xc9382c, 0xc9382c, W, W, W, 0xc9382c, 0xc9382c, 0x17181c] },
  yellow: { cells: [0x17181c, 0xf2c014, 0xf2c014, 0xf2c014, 0x17181c, 0xf2c014, 0xf2c014, 0xf2c014, 0x17181c] },
  green: { cells: [0x1d3b2a, 0x9be22d, 0x9be22d, W, 0x9be22d, W, 0x9be22d, 0x9be22d, 0x1d3b2a] },
  orange: { cells: [0xe85a12, 0xe85a12, W, 0xe85a12, 0xe85a12, 0xe85a12, W, 0xe85a12, 0xe85a12] },
  purple: { cells: [0x3b1d5c, 0x7d3cc8, 0xe0509a, 0x7d3cc8, W, 0x7d3cc8, 0xe0509a, 0x7d3cc8, 0x3b1d5c] },
  black: { cells: [0x1c1d21, 0x26272c, 0x1c1d21, 0x26272c, 0x8a8d94, 0x26272c, 0x1c1d21, 0x26272c, 0x1c1d21] },
  rainbow: {
    cells: [0xd8281e, 0xf2781e, 0xf2c014, 0x4cb648, 0x2a9fd6, 0x2a5fd0, 0x7a3fc1, 0xd23f8c, 0xd8281e],
  },
};

export const isCanopyColor = (id: unknown): id is CanopyColorId => typeof id === 'string' && Object.hasOwn(CANOPY_COLORS, id);

/** A reserve's seven cells: white, with a darker band either side of the middle. */
export const RESERVE_PALETTE = [W, 0x1f3f78, W, W, W, 0x1f3f78, W];
