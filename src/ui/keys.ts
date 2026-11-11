// The keys for what the pilot is doing right now, down one side of the
// screen: the keyboard's (AZERTY letters, as the help in the menu gives them)
// or the gamepad's, whichever was used last. Gamepad controls are drawn as
// small pictures of the controls themselves (round face button, bumpers,
// triggers, sticks, the cross with the right arm lit), named the Xbox or
// the PlayStation way.

export type KeysPhase = 'plane' | 'freefall' | 'canopy' | 'ground';
export type InputKind = 'keyboard' | 'gamepad';
export type PadKind = 'xbox' | 'playstation';

/** A gamepad control, drawn rather than spelt out. */
type PadControl = 'a' | 'lb' | 'rb' | 'lt' | 'rt' | 'ls' | 'rs' | 'cross' | 'up' | 'down' | 'left' | 'right';

/** Keyboard keys as written on the caps, or gamepad controls; and what they do. */
type Row = [keys: string[], what: string];

const KEYBOARD: Record<KeysPhase, Row[]> = {
  plane: [
    [['Espace'], 'sauter'],
    [['↑', '↓', '←', '→'], 'position de sortie'],
    [['Souris'], 'regarder'],
  ],
  freefall: [
    [['Z', 'S'], 'avancer / reculer'],
    [['Q', 'D'], 'tourner'],
    [['A', 'E'], 'glisser'],
    [['R', 'F'], 'monter / descendre'],
    [['↑', '↓'], 'assis / tête en bas'],
    [['←', '→'], 'à plat / dos'],
    [['Espace'], 'ouvrir'],
  ],
  canopy: [
    [['Q', 'D'], 'commande gauche / droite'],
    [['S'], 'les deux commandes'],
    [['A', 'E'], 'avant gauche / droit'],
    [['Z'], 'les deux avants'],
    [['Maj'], 'maintenir les commandes'],
    [['Souris'], 'regarder, C recentrer'],
  ],
  ground: [
    [['R'], 'recommencer'],
    [['1', '2', '3'], 'circuit / finale / avion'],
  ],
};

const GAMEPAD: Record<KeysPhase, [PadControl[], string][] | null> = {
  plane: [
    [['a'], 'sauter'],
    [['cross'], 'position de sortie'],
    [['rs'], 'regarder'],
  ],
  freefall: [
    [['ls'], 'avancer, reculer, glisser'],
    [['lt', 'rt'], 'tourner'],
    [['lb', 'rb'], 'monter / descendre'],
    [['up', 'down'], 'assis / tête en bas'],
    [['left', 'right'], 'à plat / dos'],
    [['a'], 'ouvrir'],
  ],
  canopy: [
    [['lt', 'rt'], 'commande gauche / droite'],
    [['lb', 'rb'], 'avant gauche / droit'],
    [['rs'], 'regarder'],
  ],
  // The gamepad has nothing for these: the keyboard does it.
  ground: null,
};

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
            'croix',
          );
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
        `stick ${c === 'ls' ? 'gauche' : 'droit'}`,
      );
    }
    case 'cross':
      return cross(['up', 'down', 'left', 'right'], 'croix');
    default:
      return cross([c], `croix ${c}`);
  }
}

const caps = (keys: string[]): string => keys.map((k) => `<kbd>${k}</kbd>`).join('');

/** The overlay for a moment of the jump and a device, as HTML. */
export function keysHtml(phase: KeysPhase, input: InputKind, pad: PadKind = 'xbox'): string {
  const padRows = input === 'gamepad' ? GAMEPAD[phase] : null;
  const body = padRows
    ? padRows.map(([controls, what]) => `<span>${controls.map((c) => padIcon(c, pad)).join('')}</span><span>${what}</span>`).join('')
    : KEYBOARD[phase].map(([keys, what]) => `<span>${caps(keys)}</span><span>${what}</span>`).join('');
  return `${body}<span class="foot">${caps(['V'])} menu · ${caps(['K'])} masquer</span>`;
}
