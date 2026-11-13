// Where the picture sits on the screen. A phone is flown on its side, with
// both thumbs. Held upright (its rotation locked, or a browser that cannot
// turn the page), everything is drawn on its side all the same, a quarter
// turn round, the menu included: nothing to unlock, the phone is simply
// turned, and stays that way from the menu to the landing.

let sideways = false;

/** A phone or a tablet: the finger is what points, not a mouse beside a screen that can be touched. */
export const handheld = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Everything is drawn a quarter turn round, on a phone held upright. */
export const isSideways = (): boolean => sideways;

/** Call every frame. True when the picture has just been turned, or turned back: its size changed. */
export function updateSideways(): boolean {
  const on = handheld() && window.innerHeight > window.innerWidth;
  if (on === sideways) return false;
  sideways = on;
  document.documentElement.classList.toggle('sideways', on);
  return true;
}

/** The size of the picture, px: the window's, the other way round when on its side. */
export function viewSize(): { width: number; height: number } {
  const style = document.documentElement.style;
  const size = sideways
    ? { width: window.innerHeight, height: window.innerWidth }
    : { width: window.innerWidth, height: window.innerHeight };
  // For the style sheet, which lays the turned picture out (see index.html).
  style.setProperty('--view-w', `${size.width}px`);
  style.setProperty('--view-h', `${size.height}px`);
  return size;
}

/** A point of the window, as a pointer gives it, in the picture: the same, or a quarter turn back. */
export function toView(clientX: number, clientY: number): { x: number; y: number } {
  return sideways ? { x: clientY, y: window.innerWidth - clientX } : { x: clientX, y: clientY };
}
