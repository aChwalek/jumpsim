// The drop zones on offer.

import { createValbrise, type DzPack } from './dz';
import { createPujaut } from './pujaut';

export type DzId = 'valbrise' | 'pujaut';

export interface DzInfo {
  id: DzId;
  name: string;
  /** One line under the name in the menu. */
  note: string;
  /** Built on first use, then kept. */
  pack(): DzPack;
}

const once = (create: () => DzPack): (() => DzPack) => {
  let pack: DzPack | undefined;
  return () => (pack ??= create());
};

export const DZS: DzInfo[] = [
  { id: 'valbrise', name: 'Valbrise', note: 'Aérodrome imaginaire, plat, avec un pond', pack: once(createValbrise) },
  { id: 'pujaut', name: 'Pujaut', note: "D'après Skydive Pujaut (LFNT) : vraie géographie", pack: once(createPujaut) },
];

export function dzInfo(id: DzId): DzInfo {
  return DZS.find((d) => d.id === id) ?? DZS[0]!;
}
