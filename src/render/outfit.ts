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

/** Colours glow sticks come in, as they look lit. Named in T.menu.gear.glowColors. */
export const GLOW_COLORS = {
  green: 0x5dff6a,
  yellow: 0xfff04a,
  orange: 0xff9a2a,
  red: 0xff3b3b,
  blue: 0x4aa8ff,
  pink: 0xff5ad2,
} as const;
export type GlowColor = keyof typeof GLOW_COLORS;
export const GLOW_COLOR_IDS = Object.keys(GLOW_COLORS) as GlowColor[];
export const isGlowColor = (v: unknown): v is GlowColor => typeof v === 'string' && Object.hasOwn(GLOW_COLORS, v);
export const DEFAULT_GLOW: GlowColor = 'green';

/** What the jumper wears, as drawn: colours of the helmet, the jumpsuit and the glow sticks. */
export interface Outfit {
  helmet: number;
  suit: number;
  glow: number;
}

export const DEFAULT_HELMET: OutfitColor = 'white';
export const DEFAULT_SUIT: OutfitColor = 'navy';
