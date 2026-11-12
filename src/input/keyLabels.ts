// What is printed on the keys the sim listens to. It listens to key
// positions (KeyW is the key left of E, whatever is printed on it), so the
// help has to name them the way the keyboard in use prints them: Z on an
// AZERTY keyboard, W on a QWERTY one. Chrome and Edge can tell; elsewhere the
// language decides: AZERTY for French, QWERTY for English.

import { lang } from '../i18n';

/** Where AZERTY prints another letter than QWERTY, on the keys the sim uses. */
const AZERTY: Record<string, string> = { KeyA: 'Q', KeyQ: 'A', KeyW: 'Z', KeyZ: 'W' };

let layout: ReadonlyMap<string, string> | null = null;

interface KeyboardWithLayout {
  getLayoutMap(): Promise<ReadonlyMap<string, string>>;
}

/** Asks the browser for the keyboard layout, if it can tell. Waits no more than a moment. */
export async function readKeyboardLayout(): Promise<void> {
  const keyboard = (navigator as Navigator & { keyboard?: KeyboardWithLayout }).keyboard;
  if (!keyboard?.getLayoutMap) return;
  try {
    const map = await Promise.race([keyboard.getLayoutMap(), new Promise<null>((done) => setTimeout(() => done(null), 400))]);
    if (map && map.size) layout = map;
  } catch {
    // Not allowed here (in a frame, say): the language decides.
  }
}

/** The label of a key, from its code: 'KeyW' gives Z on AZERTY. */
export function keyLabel(code: string): string {
  if (!code.startsWith('Key')) return code;
  const printed = layout?.get(code);
  if (printed && /^\p{L}$/u.test(printed)) return printed.toUpperCase();
  const letter = code.slice(3);
  return lang === 'fr' ? (AZERTY[code] ?? letter) : letter;
}
