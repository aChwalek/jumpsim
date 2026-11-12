// The keys for what the pilot is doing right now, down one side of the
// screen: the keyboard's (as printed on the keyboard in use, see keyLabels)
// or the gamepad's, whichever was used last. Gamepad controls are drawn as
// small pictures of the controls themselves (round face button, bumpers,
// triggers, sticks, the cross with the right arm lit), named the Xbox or
// the PlayStation way.

import { T } from '../i18n';
import { keyLabel } from '../input/keyLabels';

/** `ledge`: on top of a BASE object, before the exit; `baseCanopy`: under its one canopy, which cannot be cut away. */
export type KeysPhase = 'ledge' | 'plane' | 'freefall' | 'wingsuit' | 'canopy' | 'baseCanopy' | 'ground';
export type InputKind = 'keyboard' | 'gamepad';
export type PadKind = 'xbox' | 'playstation';

/** A gamepad control, drawn rather than spelt out. */
type PadControl = 'a' | 'b' | 'x' | 'y' | 'start' | 'view' | 'lb' | 'rb' | 'lt' | 'rt' | 'ls' | 'rs' | 'cross' | 'up' | 'down' | 'left' | 'right';

/** Keyboard keys as written on the caps, or gamepad controls; and what they do. */
type Row = [keys: string[], what: string];

function keyboardRows(phase: KeysPhase): Row[] {
  const k = keyLabel;
  const t = T.keys;
  switch (phase) {
    case 'baseCanopy':
      return keyboardRows('canopy').filter(([, what]) => what !== t.cutaway);
    case 'ledge':
      return [
        [[k('KeyW'), k('KeyS')], t.run],
        [[k('KeyA'), k('KeyD')], t.sidestep],
        [[k('KeyQ'), k('KeyE')], t.turn],
        [[t.space], t.leap],
        [['↑', '↓', '←', '→'], t.exitPosition],
        [[t.mouse], t.look],
        [[k('KeyT'), k('KeyL')], t.targetLock],
        [[k('KeyB')], t.outsideCamera],
      ];
    case 'plane':
      return [
        [[t.space], t.exit],
        [['↑', '↓', '←', '→'], t.exitPosition],
        [[t.mouse], t.look],
        [[k('KeyT'), k('KeyL')], t.targetLock],
        [[k('KeyB')], t.outsideCamera],
      ];
    case 'freefall':
      return [
        [[k('KeyW'), k('KeyS')], t.fwdBack],
        [[k('KeyA'), k('KeyD')], t.turn],
        [[k('KeyQ'), k('KeyE')], t.slide],
        [[k('KeyR'), k('KeyF')], t.upDown],
        [['↑', '↓'], t.sitHeadDown],
        [['←', '→'], t.bellyBack],
        [[t.shift], t.track],
        [[t.space], t.pullReserve],
        [[k('KeyT'), k('KeyL')], t.targetLock],
        [[k('KeyB')], t.outsideCamera],
      ];
    case 'wingsuit':
      return [
        [[k('KeyW'), k('KeyS')], t.diveFlare],
        [[k('KeyA'), k('KeyD')], t.turn],
        [[k('KeyQ'), k('KeyE')], t.slide],
        [[k('KeyR'), k('KeyF')], t.wingsWideTight],
        [['←', '→'], t.wingsuitRoll],
        [[t.space], t.pullReserve],
        [[k('KeyT'), k('KeyL')], t.targetLock],
        [[k('KeyB')], t.outsideCamera],
      ];
    case 'canopy':
      return [
        [[k('KeyA'), k('KeyD')], t.toggles],
        [[k('KeyS')], t.bothToggles],
        [[k('KeyQ'), k('KeyE')], t.fronts],
        [[k('KeyW')], t.bothFronts],
        [[t.shift], t.hold],
        [[k('KeyG')], t.slider],
        [[k('KeyX')], t.cutaway],
        [[t.mouse], t.lookRecentre(k('KeyC'))],
        [[k('KeyT'), k('KeyL')], t.targetLock],
        [[k('KeyB')], t.cameraZoom],
      ];
    case 'ground':
      return [
        [[k('KeyW'), k('KeyS')], t.walk],
        [[k('KeyQ'), k('KeyE')], t.turn],
        [[k('KeyA'), k('KeyD')], t.sidestep],
        [[t.space], t.gather],
        [[k('KeyR')], t.restart],
        [['1', '2', '3'], t.starts],
        [[k('KeyT'), k('KeyL')], t.targetLock],
        [[k('KeyB')], t.outsideCamera],
      ];
  }
}

function gamepadRows(phase: KeysPhase): [PadControl[], string][] {
  const t = T.keys;
  switch (phase) {
    case 'baseCanopy':
      return gamepadRows('canopy').filter(([, what]) => what !== t.cutaway);
    case 'ledge':
      return [
        [['ls'], t.run],
        [['lt', 'rt'], t.turn],
        [['a'], t.leap],
        [['cross'], t.exitPosition],
        [['rs'], t.look],
        [['rs'], t.targetLockPad],
        [['view'], t.camera],
      ];
    case 'plane':
      return [
        [['a'], t.exit],
        [['cross'], t.exitPosition],
        [['rs'], t.look],
        [['rs'], t.targetLockPad],
        [['view'], t.camera],
      ];
    case 'freefall':
      return [
        [['ls'], t.fwdBackSlide],
        [['lt', 'rt'], t.turn],
        [['lb', 'rb'], t.upDown],
        [['up', 'down'], t.sitHeadDown],
        [['left', 'right'], t.bellyBack],
        [['ls'], t.trackPress],
        [['a'], t.pullReserve],
        [['rs'], t.targetLockPad],
        [['view'], t.camera],
      ];
    case 'wingsuit':
      return [
        [['ls'], t.diveFlare],
        [['lt', 'rt'], t.turn],
        [['lb', 'rb'], t.wingsWideTight],
        [['left', 'right'], t.wingsuitRoll],
        [['a'], t.pullReserve],
        [['rs'], t.targetLockPad],
        [['view'], t.camera],
      ];
    case 'canopy':
      return [
        [['lt', 'rt'], t.toggles],
        [['lb', 'rb'], t.fronts],
        [['x'], t.slider],
        [['b'], t.cutaway],
        [['rs'], t.look],
        [['rs'], t.targetLockPad],
        [['view'], t.camera],
      ];
    case 'ground':
      return [
        [['y'], t.restart],
        [['rs'], t.targetLockPad],
        [['view'], t.camera],
        [['start'], t.menu],
      ];
  }
}

const NAMES: Record<PadKind, Record<'lb' | 'rb' | 'lt' | 'rt', string>> = {
  xbox: { lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT' },
  playstation: { lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2' },
};

const LINE = 'rgba(255,255,255,0.85)';
const BODY = 'rgba(0,0,0,0.4)';
const FONT = "font-family=\"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif\" font-weight=\"700\" text-anchor=\"middle\" fill=\"#fff\"";

const svg = (w: number, h: number, inner: string, title: string): string =>
  `<svg class="pad" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}"><title>${title}</title>${inner}</svg>`;

/** The cross, the arms given lit. */
function cross(lit: ('up' | 'down' | 'left' | 'right')[], title: string): string {
  // The whole cross outlined, the arms that count filled in.
  const arm = (on: boolean, x: number, y: number, w: number, h: number) =>
    on ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffd84a"/>` : '';
  return svg(
    28,
    28,
    `<path d="M10 1.5 H18 V10 H26.5 V18 H18 V26.5 H10 V18 H1.5 V10 H10 Z" fill="${BODY}" stroke="${LINE}" stroke-linejoin="round"/>` +
      arm(lit.includes('up'), 10.5, 2, 7, 8.5) +
      arm(lit.includes('down'), 10.5, 17.5, 7, 8.5) +
      arm(lit.includes('left'), 2, 10.5, 8.5, 7) +
      arm(lit.includes('right'), 17.5, 10.5, 8.5, 7),
    title,
  );
}

function padIcon(c: PadControl, kind: PadKind): string {
  switch (c) {
    case 'a':
      // Xbox: the green A. PlayStation: the blue cross on a dark button.
      return kind === 'xbox'
        ? svg(26, 26, `<circle cx="13" cy="13" r="11.5" fill="#2f9e44" stroke="${LINE}"/><text x="13" y="18" font-size="14" ${FONT}>A</text>`, 'A')
        : svg(
            26,
            26,
            `<circle cx="13" cy="13" r="11.5" fill="${BODY}" stroke="${LINE}"/><path d="M8.5 8.5 L17.5 17.5 M17.5 8.5 L8.5 17.5" stroke="#8fb4ff" stroke-width="2.4" stroke-linecap="round"/>`,
            T.keys.psCross,
          );
    case 'b':
      // Xbox: the red B. PlayStation: the red circle.
      return kind === 'xbox'
        ? svg(26, 26, `<circle cx="13" cy="13" r="11.5" fill="#c4332b" stroke="${LINE}"/><text x="13" y="18" font-size="14" ${FONT}>B</text>`, 'B')
        : svg(26, 26, `<circle cx="13" cy="13" r="11.5" fill="${BODY}" stroke="${LINE}"/><circle cx="13" cy="13" r="5.5" fill="none" stroke="#ff6b6b" stroke-width="2.2"/>`, T.keys.circle);
    case 'x':
      // Xbox: the blue X. PlayStation: the pink square.
      return kind === 'xbox'
        ? svg(26, 26, `<circle cx="13" cy="13" r="11.5" fill="#2b6fc4" stroke="${LINE}"/><text x="13" y="18" font-size="14" ${FONT}>X</text>`, 'X')
        : svg(26, 26, `<circle cx="13" cy="13" r="11.5" fill="${BODY}" stroke="${LINE}"/><rect x="8.5" y="8.5" width="9" height="9" fill="none" stroke="#f19bd4" stroke-width="2"/>`, T.keys.square);
    case 'view': {
      // The small button on the left: View on an Xbox pad, Share / Create on a PlayStation one.
      const name = kind === 'xbox' ? 'View' : 'Share';
      return svg(46, 20, `<rect x="1.5" y="2.5" width="43" height="15" rx="7.5" fill="${BODY}" stroke="${LINE}"/><text x="23" y="14" font-size="9.5" ${FONT}>${name}</text>`, name);
    }
    case 'y':
      // Xbox: the yellow Y. PlayStation: the green triangle.
      return kind === 'xbox'
        ? svg(26, 26, `<circle cx="13" cy="13" r="11.5" fill="#c99a06" stroke="${LINE}"/><text x="13" y="18" font-size="14" ${FONT}>Y</text>`, 'Y')
        : svg(
            26,
            26,
            `<circle cx="13" cy="13" r="11.5" fill="${BODY}" stroke="${LINE}"/><path d="M13 7.5 L18.5 17 H7.5 Z" fill="none" stroke="#5fd6a4" stroke-width="2" stroke-linejoin="round"/>`,
            T.keys.triangle,
          );
    case 'start': {
      // The small button in the middle: Menu on an Xbox pad, Options on a PlayStation one.
      const name = kind === 'xbox' ? 'Menu' : 'Options';
      return svg(46, 20, `<rect x="1.5" y="2.5" width="43" height="15" rx="7.5" fill="${BODY}" stroke="${LINE}"/><text x="23" y="14" font-size="9.5" ${FONT}>${name}</text>`, name);
    }
    case 'lb':
    case 'rb': {
      // A bumper: wide, flat, rounded towards the top.
      const name = NAMES[kind][c];
      return svg(38, 22, `<path d="M2 20 V10 Q2 3 10 3 H28 Q36 3 36 10 V20 Z" fill="${BODY}" stroke="${LINE}"/><text x="19" y="16.5" font-size="11" ${FONT}>${name}</text>`, name);
    }
    case 'lt':
    case 'rt': {
      // A trigger: tall, its top rounded off.
      const name = NAMES[kind][c];
      return svg(30, 28, `<path d="M3 26 V12 Q3 2 15 2 Q27 2 27 12 V26 Z" fill="${BODY}" stroke="${LINE}"/><text x="15" y="20" font-size="11" ${FONT}>${name}</text>`, name);
    }
    case 'ls':
    case 'rs': {
      // A stick: the well, the cap, and which one on it.
      const name = c === 'ls' ? 'L' : 'R';
      return svg(
        28,
        28,
        `<circle cx="14" cy="14" r="12.5" fill="${BODY}" stroke="${LINE}"/><circle cx="14" cy="14" r="7.5" fill="rgba(255,255,255,0.9)"/><text x="14" y="18" font-size="11" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-weight="700" text-anchor="middle" fill="#111">${name}</text>`,
        c === 'ls' ? T.keys.stickL : T.keys.stickR,
      );
    }
    case 'cross':
      return cross(['up', 'down', 'left', 'right'], T.keys.dpad);
    default:
      return cross([c], `${T.keys.dpad} ${c}`);
  }
}

const caps = (keys: string[]): string => keys.map((k) => `<kbd>${k}</kbd>`).join('');

/** The overlay for a moment of the jump and a device, as HTML. */
export function keysHtml(phase: KeysPhase, input: InputKind, pad: PadKind = 'xbox'): string {
  const padRows = input === 'gamepad' ? gamepadRows(phase) : null;
  const body = padRows
    ? padRows.map(([controls, what]) => `<span>${controls.map((c) => padIcon(c, pad)).join('')}</span><span>${what}</span>`).join('')
    : keyboardRows(phase).map(([keys, what]) => `<span>${caps(keys)}</span><span>${what}</span>`).join('');
  const foot = padRows
    ? `${padIcon('start', pad)} ${T.keys.menu}`
    : `${caps([keyLabel('KeyV')])} ${T.keys.menu} · ${caps([keyLabel('KeyK')])} ${T.keys.hide}`;
  return `${body}<span class="foot">${foot}</span>`;
}
