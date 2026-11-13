// The controls on a touch screen, over the picture: a toggle or a stick under
// each thumb, drawn where the thumb went down, and the few buttons the
// moment of the jump calls for. It only passes the fingers on (see
// input/touch) and draws what they hold: what the controls do is read by
// InputDevices, as for a gamepad.

import './touch.css';
import { T } from '../i18n';
import type { Action, InputDevices } from '../input/devices';
import { brakeTravel, FRONT_AFTER, STICK_RADIUS, type Finger, type TouchMode } from '../input/touch';
import { handheld, toView, viewSize } from '../viewport';

/** What is on the glass at this moment of the jump. */
export interface TouchLayout {
  mode: TouchMode;
  /** The big button under the right hand: what it says, or null for none. */
  main: string | null;
  /** The cross: positions in freefall and in the door. */
  cross: boolean;
  /** The track button, lit or not; null for none. */
  track: boolean | null;
  cutaway: boolean;
  slider: boolean;
}

type Button = 'jump' | 'openMenu' | 'camera' | 'track' | 'slider' | 'cutaway' | 'up' | 'down' | 'left' | 'right';

/** Buttons that act once, as they go down. */
const PRESS: Partial<Record<Button, Action>> = {
  jump: 'jump',
  openMenu: 'openMenu',
  camera: 'camera',
  track: 'track',
  slider: 'slider',
  up: 'flyUp',
  down: 'flyDown',
  left: 'flyLeft',
  right: 'flyRight',
};

const svg = (body: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const ARROW = svg('<path d="M12 5 L20 18 H4 Z" fill="currentColor"/>');
const MENU = svg('<path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>');
const CAMERA = svg(
  '<path d="M4 8h3l1.6-2.4h6.8L17 8h3v11H4Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><circle cx="12" cy="13.2" r="3.3" fill="none" stroke="currentColor" stroke-width="1.9"/>',
);

/**
 * On a phone, the whole screen and on its side: the jump is flown with both
 * thumbs. Only from a tap, and only where the browser can: not on an
 * iPhone, where the jump is drawn on its side instead (see viewport).
 */
export function goLandscape(): void {
  if (!handheld()) return;
  type Lockable = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
  const lock = (): void => void (screen.orientation as Lockable | undefined)?.lock?.('landscape').catch(() => {});
  if (document.fullscreenElement) return lock();
  const whole = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  void whole?.then(lock).catch(() => {});
}

/** Where a hand's control waits for the thumb, as shares of the screen's width and height. */
const REST_X = 0.15;
const STICK_REST_Y = 0.66;

export class TouchControls {
  private readonly hands: Record<'left' | 'right', HTMLElement>;
  private readonly buttons = new Map<Button, HTMLButtonElement>();
  private readonly main: HTMLButtonElement;
  private shown = false;
  /** What was last written to the page, to write it again only when it changes. */
  private drawn = '';
  private lang = T;

  constructor(
    private readonly root: HTMLElement,
    private readonly devices: InputDevices,
  ) {
    root.innerHTML = `
      <div class="hand left"><i class="rail"></i><i class="knob"></i></div>
      <div class="hand right"><i class="rail"></i><i class="knob"></i></div>
      <div class="top">
        <button data-btn="openMenu">${MENU}</button>
        <button data-btn="camera">${CAMERA}</button>
      </div>
      <div class="cross">
        <button data-btn="up">${ARROW}</button>
        <button data-btn="left">${ARROW}</button>
        <button data-btn="right">${ARROW}</button>
        <button data-btn="down">${ARROW}</button>
      </div>
      <div class="acts">
        <button data-btn="jump" class="main"></button>
        <div class="more">
          <button data-btn="track"></button>
          <button data-btn="cutaway"></button>
          <button data-btn="slider"></button>
        </div>
      </div>`;
    this.hands = {
      left: root.querySelector<HTMLElement>('.hand.left')!,
      right: root.querySelector<HTMLElement>('.hand.right')!,
    };
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-btn]')) this.bind(b, b.dataset.btn as Button);
    this.main = this.buttons.get('jump')!;
    this.words();

    const touch = devices.touch;
    root.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') {
        // A mouse after all: the keyboard's controls again, and the mouse to look around.
        devices.lastUsed = 'keyboard';
        devices.capture();
        return;
      }
      e.preventDefault();
      root.setPointerCapture(e.pointerId);
      const at = toView(e.clientX, e.clientY);
      const size = viewSize();
      touch.down(e.pointerId, at.x, at.y, size.width, size.height);
    });
    root.addEventListener('pointermove', (e) => {
      const at = toView(e.clientX, e.clientY);
      touch.move(e.pointerId, at.x, at.y);
    });
    const lift = (e: PointerEvent): void => touch.up(e.pointerId);
    root.addEventListener('pointerup', lift);
    root.addEventListener('pointercancel', lift);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** A button: it acts as the finger lands, and is held until the finger lifts. */
  private bind(b: HTMLButtonElement, name: Button): void {
    this.buttons.set(name, b);
    const hold = (on: boolean): void => {
      b.classList.toggle('down', on);
      const touch = this.devices.touch;
      // Held, the cross goes on with somersaults and rolls, as the arrows do.
      if (name === 'up' || name === 'down') touch.flip = on ? (name === 'up' ? 1 : -1) : 0;
      else if (name === 'left' || name === 'right') touch.roll = on ? (name === 'right' ? 1 : -1) : 0;
      else if (name === 'cutaway') touch.cutaway = on;
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      b.setPointerCapture(e.pointerId);
      hold(true);
      const action = PRESS[name];
      if (action && name !== 'openMenu') this.devices.onAction(action);
    });
    // The menu only once the finger has lifted: opened under it, the tap would go on to whatever the menu has there.
    if (name === 'openMenu') b.addEventListener('click', () => this.devices.onAction('openMenu'));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      b.addEventListener(type, (e) => {
        e.stopPropagation();
        hold(false);
      });
    }
  }

  /** What the buttons say, in the language in use. */
  private words(): void {
    this.lang = T;
    const t = T.touch;
    this.buttons.get('track')!.textContent = t.track;
    this.buttons.get('cutaway')!.textContent = t.cutaway;
    this.buttons.get('slider')!.textContent = t.slider;
    this.buttons.get('openMenu')!.setAttribute('aria-label', t.menu);
    this.buttons.get('camera')!.setAttribute('aria-label', t.camera);
  }

  /** Call every frame: what is on the glass now, or null for nothing (a menu, or no touch screen in use). */
  update(layout: TouchLayout | null): void {
    const touch = this.devices.touch;
    if (!layout) {
      if (!this.shown) return;
      this.shown = false;
      this.drawn = '';
      this.root.classList.remove('on');
      touch.clear();
      for (const b of this.buttons.values()) b.classList.remove('down');
      return;
    }
    if (!this.shown) {
      this.shown = true;
      this.root.classList.add('on');
    }
    if (this.lang !== T) this.words();
    touch.setMode(layout.mode);

    const { width: w, height: h } = viewSize();
    const held: Partial<Record<'left' | 'right', Finger>> = {};
    for (const f of touch.fingers.values()) if (f.role === 'left' || f.role === 'right') held[f.role] = f;
    const kind = layout.mode === 'canopy' ? 'slider' : 'stick';
    const hands = (['left', 'right'] as const).map((side) => {
      // The right hand has a control of its own under canopy and in freefall only.
      const has = layout.mode !== 'look' && (side === 'left' || layout.mode !== 'walk');
      if (!has) return 'none';
      const f = held[side];
      const travel = brakeTravel(h);
      const restX = side === 'left' ? w * REST_X : w * (1 - REST_X);
      const restY = kind === 'slider' ? h - 18 - travel : h * STICK_REST_Y;
      const x0 = f ? f.x0 : restX;
      const y0 = f ? f.y0 : restY;
      let dx = f ? f.x - f.x0 : 0;
      let dy = f ? f.y - f.y0 : 0;
      if (kind === 'slider') {
        dx = 0;
        dy = Math.max(-FRONT_AFTER - 14, Math.min(travel, dy));
      } else {
        const far = Math.hypot(dx, dy);
        if (far > STICK_RADIUS) {
          dx *= STICK_RADIUS / far;
          dy *= STICK_RADIUS / far;
        }
      }
      const front = kind === 'slider' && dy < -FRONT_AFTER;
      return `${kind} ${f ? 'held' : ''} ${front ? 'front' : ''}|${x0.toFixed(0)}|${y0.toFixed(0)}|${dx.toFixed(0)}|${dy.toFixed(0)}|${travel.toFixed(0)}`;
    });
    const drawn = `${hands.join('/')}/${layout.main}|${layout.cross}|${layout.track}|${layout.cutaway}|${layout.slider}`;
    if (drawn === this.drawn) return;
    this.drawn = drawn;

    (['left', 'right'] as const).forEach((side, i) => {
      const el = this.hands[side];
      const [cls, x0, y0, dx, dy, travel] = hands[i]!.split('|');
      el.className = `hand ${side} ${cls}`;
      if (cls === 'none') return;
      el.style.transform = `translate(${x0}px, ${y0}px)`;
      el.style.setProperty('--dx', `${dx}px`);
      el.style.setProperty('--dy', `${dy}px`);
      el.style.setProperty('--travel', `${travel}px`);
    });
    this.main.hidden = layout.main === null;
    if (layout.main !== null && this.main.textContent !== layout.main) this.main.textContent = layout.main;
    this.root.querySelector<HTMLElement>('.cross')!.hidden = !layout.cross;
    const track = this.buttons.get('track')!;
    track.hidden = layout.track === null;
    track.classList.toggle('lit', layout.track === true);
    this.buttons.get('cutaway')!.hidden = !layout.cutaway;
    this.buttons.get('slider')!.hidden = !layout.slider;
  }
}
