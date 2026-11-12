// The words on screen, in French or in English. `T` is the dictionary of the
// language in use: an ES module live binding, so every `T.menu.back` read
// after `setLanguage` gets the new language. Screens built once (the menu)
// are rebuilt when the language changes; the HUD reads T every time it writes.

import { en } from './en';
import { fr, type Strings } from './fr';

export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];
export type { Strings };

const DICTS: Record<Lang, Strings> = { fr, en };

export let lang: Lang = 'fr';
export let T: Strings = fr;

export function setLanguage(next: Lang): void {
  lang = next;
  T = DICTS[next];
  document.documentElement.lang = next;
}

/** French for a browser set to French, English for anything else. */
export function browserLanguage(): Lang {
  const langs = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some((l) => l?.toLowerCase().startsWith('fr')) ? 'fr' : 'en';
}

/**
 * A number the way the language prints it: 4 000 and 1,10 in French, 4,000
 * and 1.10 in English. French groups thousands with a narrow space that
 * Barlow does not have: a plain non-breaking space instead.
 */
export const num = (v: number, digits = 0): string =>
  v.toLocaleString(T.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/ /g, ' ');

/** A compass heading in three digits: 040°. */
export const heading = (deg: number): string => `${String(Math.round(((deg % 360) + 360) % 360)).padStart(3, '0')}°`;
