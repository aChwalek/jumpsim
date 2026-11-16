// Independent colours for the helmet, top, trousers and shoes.
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

/** Rendered appearance. Optional additions preserve callers with the original two colours. */
export interface Outfit {
  helmet: number;
  suit: number;
  glow: number;
  pants?: number;
  shoes?: number;
  face?: boolean;
  helmetKind?: HelmetKind;
  visorRaised?: boolean;
  goggles?: boolean;
  skin?: number;
  pattern?: SuitPattern;
  accent?: number;
}

export const DEFAULT_HELMET: OutfitColor = 'white';
export const DEFAULT_SUIT: OutfitColor = 'navy';

export const HELMET_KINDS = ['full', 'open'] as const;
export type HelmetKind = typeof HELMET_KINDS[number];
export const SUIT_PATTERNS = ['plain', 'stripes', 'chevrons', 'split'] as const;
export type SuitPattern = typeof SUIT_PATTERNS[number];
export const SKIN_COLORS = { light: 0xf0c9a5, tan: 0xc89065, brown: 0x935d3c, dark: 0x513525 } as const;
export type SkinColor = keyof typeof SKIN_COLORS;
export const SKIN_COLOR_IDS = Object.keys(SKIN_COLORS) as SkinColor[];
export const isSkinColor = (v: unknown): v is SkinColor => typeof v === 'string' && Object.hasOwn(SKIN_COLORS, v);
