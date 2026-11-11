// The gear menu shown before a jump: canopy kind and size, and weight under it.

import { DEFAULT_RIG, deriveRig, rigConfig, type CanopyKind, type RigParams } from '../sim/rig';
import { trimSpeeds } from '../sim/telemetry';

/** Canopy sizes on offer, ft², largest first. Cross-braced ones only come small. */
export const CANOPY_SIZES: Record<CanopyKind, number[]> = {
  classic: [260, 230, 210, 190, 170, 150, 135, 120, 107, 96, 84],
  triCell: [120, 107, 96, 84, 75, 67],
};
export const KIND_NAMES: Record<CanopyKind, string> = { classic: 'classique', triCell: 'tri-cell' };
/** Pilot plus all gear, kg. */
export const WEIGHT_MIN = 50;
export const WEIGHT_MAX = 130;

export interface Gear {
  kind: CanopyKind;
  canopyAreaFt2: number;
  exitWeightKg: number;
}

export const rigFor = (gear: Gear): RigParams =>
  deriveRig(rigConfig(gear.kind, gear.canopyAreaFt2, gear.exitWeightKg));

export type Start = 'pattern' | 'final' | 'plane';

const STORE = 'gear';

const nearestSize = (kind: CanopyKind, area: number): number =>
  CANOPY_SIZES[kind].reduce((best, size) => (Math.abs(size - area) < Math.abs(best - area) ? size : best));

const validWeight = (kg: number): number => Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, Math.round(kg)));

/** The gear chosen last time, or the default rig. */
export function loadGear(): Gear {
  const gear: Gear = {
    kind: 'classic',
    canopyAreaFt2: DEFAULT_RIG.canopyAreaFt2,
    exitWeightKg: DEFAULT_RIG.exitWeightKg,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Gear>;
    if (saved.kind === 'triCell') gear.kind = saved.kind;
    if (Number.isFinite(saved.canopyAreaFt2)) gear.canopyAreaFt2 = saved.canopyAreaFt2!;
    if (Number.isFinite(saved.exitWeightKg)) gear.exitWeightKg = validWeight(saved.exitWeightKg!);
  } catch {
    // Nothing usable saved: keep the default.
  }
  gear.canopyAreaFt2 = nearestSize(gear.kind, gear.canopyAreaFt2);
  return gear;
}

/** Who usually flies a canopy loaded like this, lb/ft². */
export function loadingLabel(wingLoading: number): string {
  if (wingLoading < 0.8) return 'école';
  if (wingLoading < 1.1) return 'débutant';
  if (wingLoading < 1.35) return 'intermédiaire';
  if (wingLoading < 1.7) return 'confirmé';
  if (wingLoading < 2.1) return 'expert';
  return 'compétition';
}

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

export class Menu {
  isOpen = false;
  /** Called with the chosen gear when the jump starts. */
  onStart: (gear: Gear, start: Start) => void = () => {};
  /** Called when the menu is closed without starting a new jump. */
  onCancel: () => void = () => {};

  private readonly root = el('menu');
  private readonly kinds = el('menuKinds');
  private readonly sizes = el('menuSizes');
  private readonly weight = el<HTMLInputElement>('menuWeight');
  private readonly weightValue = el('menuWeightValue');
  private readonly loading = el('menuLoading');
  private readonly flight = el('menuFlight');
  private readonly kindButtons = new Map<CanopyKind, HTMLButtonElement>();
  private readonly sizeButtons = new Map<number, HTMLButtonElement>();
  private readonly gear: Gear;
  private start: Start = 'pattern';
  private canCancel = false;

  constructor(initial: Gear) {
    this.gear = { ...initial };
    for (const kind of Object.keys(CANOPY_SIZES) as CanopyKind[]) {
      const button = this.button(KIND_NAMES[kind], () => this.set({ kind }));
      this.kinds.append(button);
      this.kindButtons.set(kind, button);
    }
    this.offerSizes();
    this.weight.min = String(WEIGHT_MIN);
    this.weight.max = String(WEIGHT_MAX);
    this.weight.addEventListener('input', () => this.set({ exitWeightKg: Number(this.weight.value) }));
    el('menuPattern').addEventListener('click', () => this.go('pattern'));
    el('menuFinal').addEventListener('click', () => this.go('final'));
    el('menuPlane').addEventListener('click', () => this.go('plane'));
    window.addEventListener('keydown', (e) => this.key(e));
    this.show();
  }

  /** `canCancel`: a jump is under way and can be resumed. */
  open(canCancel: boolean): void {
    this.canCancel = canCancel;
    this.isOpen = true;
    this.root.classList.toggle('resumable', canCancel);
    this.root.style.display = 'flex';
  }

  /** Closes the menu and goes back to the jump under way, if there is one. */
  cancel(): void {
    if (!this.isOpen || !this.canCancel) return;
    this.close();
    this.onCancel();
  }

  private close(): void {
    this.isOpen = false;
    this.root.style.display = 'none';
    (document.activeElement as HTMLElement | null)?.blur();
  }

  private go(start: Start): void {
    this.start = start;
    localStorage.setItem(STORE, JSON.stringify(this.gear));
    this.close();
    this.onStart({ ...this.gear }, start);
  }

  private button(text: string, pick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', pick);
    return button;
  }

  /** The row of sizes the chosen kind of canopy comes in. */
  private offerSizes(): void {
    this.sizeButtons.clear();
    this.sizes.replaceChildren();
    for (const size of CANOPY_SIZES[this.gear.kind]) {
      const button = this.button(String(size), () => this.set({ canopyAreaFt2: size }));
      this.sizes.append(button);
      this.sizeButtons.set(size, button);
    }
  }

  private set(change: Partial<Gear>): void {
    const kind = this.gear.kind;
    Object.assign(this.gear, change);
    this.gear.exitWeightKg = validWeight(this.gear.exitWeightKg);
    // The other kind may not come in this size: take the nearest it has.
    this.gear.canopyAreaFt2 = nearestSize(this.gear.kind, this.gear.canopyAreaFt2);
    if (this.gear.kind !== kind) this.offerSizes();
    this.show();
  }

  private key(e: KeyboardEvent): void {
    if (!this.isOpen || e.metaKey || e.ctrlKey || e.altKey) return;
    const sizes = CANOPY_SIZES[this.gear.kind];
    const size = sizes.indexOf(this.gear.canopyAreaFt2);
    const step = e.shiftKey ? 5 : 1;
    switch (e.code) {
      case 'ArrowLeft':
        this.set({ canopyAreaFt2: sizes[Math.max(0, size - 1)]! });
        break;
      case 'ArrowRight':
        this.set({ canopyAreaFt2: sizes[Math.min(sizes.length - 1, size + 1)]! });
        break;
      case 'KeyT':
        if (!e.repeat) this.set({ kind: this.gear.kind === 'classic' ? 'triCell' : 'classic' });
        break;
      case 'ArrowUp':
        this.set({ exitWeightKg: this.gear.exitWeightKg + step });
        break;
      case 'ArrowDown':
        this.set({ exitWeightKg: this.gear.exitWeightKg - step });
        break;
      case 'Enter':
      case 'NumpadEnter':
        if (!e.repeat) this.go(this.start);
        break;
      case 'Digit1':
        if (!e.repeat) this.go('pattern');
        break;
      case 'Digit2':
        if (!e.repeat) this.go('final');
        break;
      case 'Digit3':
        if (!e.repeat) this.go('plane');
        break;
      case 'Escape':
        this.cancel();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  private show(): void {
    const { kind, canopyAreaFt2, exitWeightKg } = this.gear;
    for (const [k, button] of this.kindButtons) button.classList.toggle('on', k === kind);
    for (const [size, button] of this.sizeButtons) button.classList.toggle('on', size === canopyAreaFt2);
    this.weight.value = String(exitWeightKg);
    this.weightValue.textContent = `${exitWeightKg} kg`;
    const rig = rigFor(this.gear);
    const { forward, sink } = trimSpeeds(rig);
    this.loading.textContent = `Charge alaire ${rig.wingLoading.toFixed(2)} lb/ft² · ${loadingLabel(rig.wingLoading)}`;
    this.flight.textContent = `Bras hauts : ${(forward * 3.6).toFixed(0)} km/h, chute ${sink.toFixed(1)} m/s, finesse ${(forward / sink).toFixed(1)}`;
  }
}
