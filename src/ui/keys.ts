// The keys for what the pilot is doing right now, down one side of the
// screen: the keyboard's (AZERTY letters, as the help in the menu gives them)
// or the gamepad's, whichever was used last.

export type KeysPhase = 'plane' | 'freefall' | 'canopy' | 'ground';
export type InputKind = 'keyboard' | 'gamepad';

/** The keys, each its own cap, and what they do. */
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

const GAMEPAD: Record<KeysPhase, Row[]> = {
  plane: [
    [['A'], 'sauter'],
    [['✚'], 'position de sortie'],
    [['Stick D'], 'regarder'],
  ],
  freefall: [
    [['Stick G'], 'avancer, reculer, glisser'],
    [['LT', 'RT'], 'tourner'],
    [['LB', 'RB'], 'monter / descendre'],
    [['✚ ↑', '✚ ↓'], 'assis / tête en bas'],
    [['✚ ←', '✚ →'], 'à plat / dos'],
    [['A'], 'ouvrir'],
  ],
  canopy: [
    [['LT', 'RT'], 'commandes'],
    [['LB', 'RB'], 'élévateurs avant'],
    [['Stick D'], 'regarder'],
  ],
  // The gamepad has nothing for these: the keyboard does it.
  ground: [
    [['R'], 'recommencer'],
    [['1', '2', '3'], 'circuit / finale / avion'],
  ],
};

const caps = (keys: string[]): string => keys.map((k) => `<kbd>${k}</kbd>`).join('');

/** The overlay for a moment of the jump and a device, as HTML. */
export function keysHtml(phase: KeysPhase, input: InputKind): string {
  const rows = (input === 'gamepad' ? GAMEPAD : KEYBOARD)[phase];
  const body = rows.map(([keys, what]) => `<span>${caps(keys)}</span><span>${what}</span>`).join('');
  return `${body}<span class="foot">${caps(['V'])} menu · ${caps(['K'])} masquer</span>`;
}
