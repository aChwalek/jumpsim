// Colours on offer for what the jumper wears: the helmet's shell and the
// jumpsuit (body, arms and legs; a suit's wings keep the canopy's colour).
// Named in T.menu.gear.outfitColors.

export const OUTFIT_COLORS = {
  white: 0xe4e4e0,
  grey: 0x8a8d94,
  black: 0x1c1d21,
  navy: 0x1d2a44,
  blue: 0x2a6fd0,
  red: 0xc9382c,
  orange: 0xe85a12,
  yellow: 0xf2c014,
  green: 0x3f9a46,
  purple: 0x7d3cc8,
  pink: 0xe0509a,
} as const;
export type OutfitColor = keyof typeof OUTFIT_COLORS;
export const OUTFIT_COLOR_IDS = Object.keys(OUTFIT_COLORS) as OutfitColor[];
export const isOutfitColor = (v: unknown): v is OutfitColor => typeof v === 'string' && Object.hasOwn(OUTFIT_COLORS, v);

/** What the jumper wears, as drawn: colours of the helmet and the jumpsuit. */
export interface Outfit {
  helmet: number;
  suit: number;
}

export const DEFAULT_HELMET: OutfitColor = 'white';
export const DEFAULT_SUIT: OutfitColor = 'navy';
