// The start menu: drop zone, hour and weather on one side, gear and weight on
// the other. What changes the scenery is shown at once behind the menu.

import { HOUR_MAX, HOUR_MIN, formatHour, sunPosition } from '../render/daylight';
import { CANOPY_COLORS, type CanopyColorId } from '../render/canopyColors';
import {
  CANOPY_SIZES,
  KIND_NAMES,
  WEIGHT_MAX,
  WEIGHT_MIN,
  cloneSetup,
  loadingLabel,
  nearestSize,
  rigFor,
  saveSetup,
  usualWeather,
  validWeight,
  type AltimeterKind,
  type Gear,
  type Setup,
} from '../setup';
import type { CanopyKind } from '../sim/rig';
import { trimSpeeds } from '../sim/telemetry';
import { WIND_MAX_KMH, compassPoint, gustPeakKmh, type GustLevel, type SkyKind, type Weather } from '../sim/weather';
import { DZS, dzInfo, type DzId } from '../world/dzs';

export type Start = 'pattern' | 'final' | 'plane';

const SKIES: { value: SkyKind; label: string }[] = [
  { value: 'clear', label: 'Grand bleu' },
  { value: 'cumulus', label: 'Cumulus' },
  { value: 'hazy', label: 'Voilé' },
  { value: 'overcast', label: 'Couvert' },
];
const GUSTS: { value: GustLevel; label: string }[] = [
  { value: 'none', label: 'Aucune' },
  { value: 'light', label: 'Légères' },
  { value: 'strong', label: 'Fortes' },
];
const ALTIMETERS: { value: AltimeterKind; label: string }[] = [
  { value: 'none', label: 'Aucun' },
  { value: 'analog', label: 'À aiguille' },
  { value: 'digital', label: 'Digital' },
];
const AUDIBLE: { value: boolean; label: string }[] = [
  { value: false, label: 'Non' },
  { value: true, label: 'Oui' },
];

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

/** A row of buttons, one of them lit: the current choice. */
class Choices<T> {
  private readonly buttons: { value: T; button: HTMLButtonElement }[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly pick: (value: T) => void,
  ) {}

  /** Replaces the buttons. `html` may hold markup, such as a colour swatch. */
  offer(options: { value: T; label: string; html?: string; title?: string }[]): void {
    this.buttons.length = 0;
    this.root.replaceChildren();
    for (const o of options) {
      const button = document.createElement('button');
      button.type = 'button';
      if (o.html) button.innerHTML = o.html;
      else button.textContent = o.label;
      if (o.title ?? o.html) button.title = o.title ?? o.label;
      button.addEventListener('click', () => this.pick(o.value));
      this.root.append(button);
      this.buttons.push({ value: o.value, button });
    }
  }

  show(current: T): void {
    for (const { value, button } of this.buttons) button.classList.toggle('on', value === current);
  }
}

/** A colour swatch: the cells of the canopy side by side. */
const swatch = (id: CanopyColorId): string =>
  `<span class="swatch">${CANOPY_COLORS[id].cells
    .map((c) => `<i style="background:#${c.toString(16).padStart(6, '0')}"></i>`)
    .join('')}</span>`;

/** Where the sun is seen from final, flying into the wind. */
function sunOnFinal(azimuthDeg: number, windFromDeg: number): string {
  const off = ((azimuthDeg - windFromDeg + 540) % 360) - 180;
  if (Math.abs(off) < 50) return 'face à toi en finale';
  if (Math.abs(off) > 130) return 'dans le dos en finale';
  return off > 0 ? 'à droite en finale' : 'à gauche en finale';
}

export class Menu {
  isOpen = false;
  /** Called with the chosen setup when the jump starts. */
  onStart: (setup: Setup, start: Start) => void = () => {};
  /** Called when the menu is closed without starting a new jump. */
  onCancel: () => void = () => {};
  /** Called when the drop zone, the hour or the weather change, to show them behind the menu. */
  onPreview: (setup: Setup) => void = () => {};

  private readonly root = el('menu');
  private readonly hour = el<HTMLInputElement>('menuHour');
  private readonly hourValue = el('menuHourValue');
  private readonly sun = el('menuSun');
  private readonly windDir = el<HTMLInputElement>('menuWindDir');
  private readonly windSpeed = el<HTMLInputElement>('menuWindSpeed');
  private readonly windValue = el('menuWindValue');
  private readonly windArrow = el('menuWindArrow');
  private readonly weight = el<HTMLInputElement>('menuWeight');
  private readonly weightValue = el('menuWeightValue');
  private readonly colorName = el('menuColorName');
  private readonly loading = el('menuLoading');
  private readonly flight = el('menuFlight');
  private readonly dzs: Choices<DzId>;
  private readonly skies: Choices<SkyKind>;
  private readonly gusts: Choices<GustLevel>;
  private readonly kinds: Choices<CanopyKind>;
  private readonly sizes: Choices<number>;
  private readonly colors: Choices<CanopyColorId>;
  private readonly altimeters: Choices<AltimeterKind>;
  private readonly audible: Choices<boolean>;
  private readonly setup: Setup;
  private start: Start = 'pattern';
  private canCancel = false;

  constructor(initial: Setup) {
    this.setup = cloneSetup(initial);
    this.dzs = new Choices(el('menuDzs'), (dz) => this.setDz(dz));
    this.dzs.offer(DZS.map((d) => ({ value: d.id, label: d.name, html: `<b>${d.name}</b><span>${d.note}</span>` })));
    this.skies = new Choices(el('menuSkies'), (sky) => this.setWeather({ sky }));
    this.skies.offer(SKIES);
    this.gusts = new Choices(el('menuGusts'), (gusts) => this.setWeather({ gusts }));
    this.gusts.offer(GUSTS);
    this.kinds = new Choices(el('menuKinds'), (kind) => this.setGear({ kind }));
    this.kinds.offer((Object.keys(CANOPY_SIZES) as CanopyKind[]).map((k) => ({ value: k, label: KIND_NAMES[k] })));
    this.sizes = new Choices(el('menuSizes'), (canopyAreaFt2) => this.setGear({ canopyAreaFt2 }));
    this.offerSizes();
    this.colors = new Choices(el('menuColors'), (color) => this.setGear({ color }));
    this.colors.offer(
      (Object.keys(CANOPY_COLORS) as CanopyColorId[]).map((id) => ({ value: id, label: CANOPY_COLORS[id].name, html: swatch(id) })),
    );
    this.altimeters = new Choices(el('menuAltimeters'), (altimeter) => this.setGear({ altimeter }));
    this.altimeters.offer(ALTIMETERS);
    this.audible = new Choices(el('menuAudible'), (audible) => this.setGear({ audible }));
    this.audible.offer(AUDIBLE);

    this.hour.min = String(HOUR_MIN);
    this.hour.max = String(HOUR_MAX);
    this.hour.step = '0.25';
    this.hour.addEventListener('input', () => this.setHour(Number(this.hour.value)));
    this.windDir.min = '0';
    this.windDir.max = '355';
    this.windDir.step = '5';
    this.windDir.addEventListener('input', () => this.setWeather({ windFromDeg: Number(this.windDir.value) }));
    this.windSpeed.min = '0';
    this.windSpeed.max = String(WIND_MAX_KMH);
    this.windSpeed.step = '1';
    this.windSpeed.addEventListener('input', () => this.setWeather({ windKmh: Number(this.windSpeed.value) }));
    this.weight.min = String(WEIGHT_MIN);
    this.weight.max = String(WEIGHT_MAX);
    this.weight.addEventListener('input', () => this.setGear({ exitWeightKg: Number(this.weight.value) }));
    el('menuUsualWind').addEventListener('click', () => this.setWeather(usualWeather(this.setup.dz, this.setup.weather.sky)));
    el('menuPattern').addEventListener('click', () => this.go('pattern'));
    el('menuFinal').addEventListener('click', () => this.go('final'));
    el('menuPlane').addEventListener('click', () => this.go('plane'));
    window.addEventListener('keydown', (e) => this.key(e));
    this.show();
  }

  /** The setup as it stands in the menu. */
  get current(): Setup {
    return cloneSetup(this.setup);
  }

  /** `canCancel`: a jump is under way and can be resumed. */
  open(canCancel: boolean): void {
    this.setResumable(canCancel);
    this.isOpen = true;
    this.root.style.display = 'flex';
  }

  /** Whether the jump under way can still be resumed: not once it has moved to another drop zone. */
  setResumable(canCancel: boolean): void {
    this.canCancel = canCancel;
    this.root.classList.toggle('resumable', canCancel);
  }

  /** Closes the menu and goes back to the jump under way, if there is one. */
  cancel(): void {
    if (!this.isOpen || !this.canCancel) return;
    saveSetup(this.setup);
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
    saveSetup(this.setup);
    this.close();
    this.onStart(this.current, start);
  }

  private offerSizes(): void {
    this.sizes.offer(CANOPY_SIZES[this.setup.gear.kind].map((size) => ({ value: size, label: String(size) })));
  }

  private setDz(dz: DzId): void {
    if (dz === this.setup.dz) return;
    this.setup.dz = dz;
    // Each place comes with the wind it usually gets.
    this.setup.weather = usualWeather(dz, this.setup.weather.sky);
    this.changedScenery();
  }

  private setHour(hour: number): void {
    this.setup.hour = Math.min(HOUR_MAX, Math.max(HOUR_MIN, hour));
    this.changedScenery();
  }

  private setWeather(change: Partial<Weather>): void {
    Object.assign(this.setup.weather, change);
    const w = this.setup.weather;
    w.windFromDeg = ((Math.round(w.windFromDeg) % 360) + 360) % 360;
    w.windKmh = Math.min(WIND_MAX_KMH, Math.max(0, Math.round(w.windKmh)));
    this.changedScenery();
  }

  private changedScenery(): void {
    this.show();
    this.onPreview(this.current);
  }

  private setGear(change: Partial<Gear>): void {
    const gear = this.setup.gear;
    const kind = gear.kind;
    Object.assign(gear, change);
    gear.exitWeightKg = validWeight(gear.exitWeightKg);
    // The other kind may not come in this size: take the nearest it has.
    gear.canopyAreaFt2 = nearestSize(gear.kind, gear.canopyAreaFt2);
    if (gear.kind !== kind) this.offerSizes();
    this.show();
  }

  private key(e: KeyboardEvent): void {
    if (!this.isOpen || e.metaKey || e.ctrlKey || e.altKey) return;
    // Arrows belong to a slider that has the focus.
    const slider = e.target instanceof HTMLInputElement && e.code.startsWith('Arrow');
    if (slider) return;
    const gear = this.setup.gear;
    const sizes = CANOPY_SIZES[gear.kind];
    const size = sizes.indexOf(gear.canopyAreaFt2);
    const step = e.shiftKey ? 5 : 1;
    switch (e.code) {
      case 'ArrowLeft':
        this.setGear({ canopyAreaFt2: sizes[Math.max(0, size - 1)]! });
        break;
      case 'ArrowRight':
        this.setGear({ canopyAreaFt2: sizes[Math.min(sizes.length - 1, size + 1)]! });
        break;
      case 'KeyT':
        if (!e.repeat) this.setGear({ kind: gear.kind === 'classic' ? 'triCell' : 'classic' });
        break;
      case 'ArrowUp':
        this.setGear({ exitWeightKg: gear.exitWeightKg + step });
        break;
      case 'ArrowDown':
        this.setGear({ exitWeightKg: gear.exitWeightKg - step });
        break;
      case 'Enter':
      case 'NumpadEnter': {
        // Enter jumps, whatever was clicked last: from the start where it
        // last went, unless a start button has the focus.
        const id = (e.target as HTMLElement | null)?.id;
        if (!e.repeat) this.go(id === 'menuFinal' ? 'final' : id === 'menuPattern' ? 'pattern' : this.start);
        break;
      }
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
    const { dz, hour, weather, gear } = this.setup;
    this.dzs.show(dz);
    this.skies.show(weather.sky);
    this.gusts.show(weather.gusts);
    this.kinds.show(gear.kind);
    this.sizes.show(gear.canopyAreaFt2);
    this.colors.show(gear.color);
    this.altimeters.show(gear.altimeter);
    this.audible.show(gear.audible);
    this.colorName.textContent = CANOPY_COLORS[gear.color].name;

    this.hour.value = String(hour);
    this.hourValue.textContent = formatHour(hour);
    const pack = dzInfo(dz).pack();
    const sun = sunPosition(pack.lat, pack.lon, hour);
    const sky = weather.sky === 'overcast' ? ' (derrière les nuages)' : '';
    this.sun.textContent = `Soleil à ${Math.max(0, sun.elevationDeg).toFixed(0)}° au-dessus de l'horizon, ${sunOnFinal(sun.azimuthDeg, weather.windFromDeg)}${sky}`;

    this.windDir.value = String(weather.windFromDeg);
    this.windSpeed.value = String(weather.windKmh);
    const gust = gustPeakKmh(weather);
    const gusts = gust > weather.windKmh ? `, rafales ${gust}` : '';
    this.windValue.textContent =
      weather.windKmh === 0
        ? 'calme'
        : `du ${String(weather.windFromDeg).padStart(3, '0')}° (${compassPoint(weather.windFromDeg)}) · ${weather.windKmh} km/h${gusts}`;
    // The arrow shows where the air goes, as the windsock does.
    this.windArrow.style.transform = `rotate(${weather.windFromDeg + 180}deg)`;
    this.windArrow.style.opacity = weather.windKmh === 0 ? '0.25' : '1';

    this.weight.value = String(gear.exitWeightKg);
    this.weightValue.textContent = `${gear.exitWeightKg} kg`;
    const rig = rigFor(gear);
    const { forward, sink } = trimSpeeds(rig);
    this.loading.textContent = `Charge alaire ${rig.wingLoading.toFixed(2)} lb/ft² · ${loadingLabel(rig.wingLoading)}`;
    this.flight.textContent = `Bras hauts : ${(forward * 3.6).toFixed(0)} km/h, chute ${sink.toFixed(1)} m/s, finesse ${(forward / sink).toFixed(1)}`;
  }
}
