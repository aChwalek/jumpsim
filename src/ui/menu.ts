// The menu. The home screen sums up the jump in four cards (gear, drop zone,
// weather, jump); each opens its own screen to change it. Two corner buttons
// open the settings and the logbook. Everything can be reached with the
// mouse, the keyboard or a gamepad (see nav.ts). What changes the scenery is
// shown at once behind the menu.

import './menu.css';
import { HOUR_MAX, HOUR_MIN, formatHour, sunPosition } from '../render/daylight';
import { CANOPY_COLORS, type CanopyColorId } from '../render/canopyColors';
import { OUTCOME_GROUPS, OUTCOME_NAMES, clearLogbook, loadLogbook, logStats, type LogEntry } from '../logbook';
import { QUALITY_LEVELS, SENSITIVITY_MAX, SENSITIVITY_MIN, type Settings } from '../settings';
import {
  CANOPY_SIZES,
  EXIT_HEIGHT_MAX,
  EXIT_HEIGHT_MIN,
  EXIT_HEIGHT_STEP,
  KIND_NAMES,
  WEIGHT_MAX,
  WEIGHT_MIN,
  cloneSetup,
  loadingLabel,
  nearestSize,
  rigFor,
  runHeading,
  saveSetup,
  usualWeather,
  validExitHeight,
  validHeading,
  validWeight,
  type AltimeterKind,
  type Gear,
  type JumpPlan,
  type MalfunctionRate,
  type SliderKind,
  MALFUNCTION_ODDS,
  type Setup,
  type Start,
} from '../setup';
import { reserveSize, type CanopyKind } from '../sim/rig';
import { trimSpeeds } from '../sim/telemetry';
import {
  WIND_MAX_KMH,
  compassPoint,
  gustPeakKmh,
  windGradient,
  type GustLevel,
  type SkyKind,
  type Weather,
} from '../sim/weather';
import { landingHeading } from '../world/dz';
import { DZS, dzInfo, type DzId } from '../world/dzs';
import { Nav } from './nav';

export type { Start } from '../setup';

type Category = 'gear' | 'dz' | 'weather' | 'jump';
type ScreenId = 'home' | Category | 'settings' | 'logbook';

const CATEGORIES: { id: Category; title: string }[] = [
  { id: 'gear', title: 'GEAR' },
  { id: 'dz', title: 'DZ' },
  { id: 'weather', title: 'MÉTÉO' },
  { id: 'jump', title: 'JUMP' },
];

interface Option<T> {
  value: T;
  label: string;
  /** Markup in place of the label, such as a colour swatch. */
  html?: string;
}

const SKIES: Option<SkyKind>[] = [
  { value: 'clear', label: 'Grand bleu' },
  { value: 'cumulus', label: 'Cumulus' },
  { value: 'hazy', label: 'Voilé' },
  { value: 'overcast', label: 'Couvert' },
];
const GUSTS: Option<GustLevel>[] = [
  { value: 'none', label: 'Aucune' },
  { value: 'light', label: 'Légères' },
  { value: 'strong', label: 'Fortes' },
];
const ALTIMETERS: Option<AltimeterKind>[] = [
  { value: 'none', label: 'Aucun' },
  { value: 'analog', label: 'À aiguille' },
  { value: 'digital', label: 'Digital' },
];
const SLIDERS: Option<SliderKind>[] = [
  { value: 'fixed', label: 'Fixe' },
  { value: 'collapsible', label: 'Rétractable' },
  { value: 'removable', label: 'Amovible' },
];
const SLIDER_NOTES: Record<SliderKind, string> = {
  fixed: 'Il reste sur les maillons et claque au vent tout le vol.',
  collapsible: 'G (manette : X) sous voile pour le replier sur les maillons : moins de traînée, moins de bruit.',
  removable: 'G (manette : X) sous voile pour l\'enlever et le ranger : la voile vole un peu plus vite.',
};
const MALFUNCTIONS: Option<MalfunctionRate>[] = [
  { value: 'none', label: 'Jamais' },
  { value: 'sometimes', label: `1 sur ${MALFUNCTION_ODDS}` },
  { value: 'always', label: 'À chaque saut' },
];
const YES_NO: Option<boolean>[] = [
  { value: false, label: 'Non' },
  { value: true, label: 'Oui' },
];
const START_NAMES: Record<Start, string> = { plane: 'Avion', pattern: 'Circuit', final: 'Finale' };
/** Straight to a start from the menu, as in flight. */
const START_KEYS: Record<string, Start | undefined> = { Digit1: 'pattern', Digit2: 'final', Digit3: 'plane' };

// ---------------------------------------------------------------- helpers

type Child = Node | string;

/** A new element with classes and children. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  node.append(...children);
  return node;
}

function button(cls: string, ...children: Child[]): HTMLButtonElement {
  const b = h('button', cls, ...children);
  b.type = 'button';
  return b;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** A number as French prints it: 4 000, 1,10. */
const num = (v: number, digits = 0): string =>
  v.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const heading = (deg: number): string => `${String(Math.round(deg)).padStart(3, '0')}°`;

/** A colour swatch: the cells of the canopy side by side. */
const swatch = (id: CanopyColorId): string =>
  `<span class="swatch">${CANOPY_COLORS[id].cells
    .map((c) => `<i style="background:#${c.toString(16).padStart(6, '0')}"></i>`)
    .join('')}</span>`;

/** Where the sun is seen from final, flying this heading. */
function sunOnFinal(azimuthDeg: number, finalDeg: number): string {
  const off = ((azimuthDeg - finalDeg + 540) % 360) - 180;
  if (Math.abs(off) < 50) return 'face à toi en finale';
  if (Math.abs(off) > 130) return 'dans le dos en finale';
  return off > 0 ? 'à droite en finale' : 'à gauche en finale';
}

/** How the wind meets a plane on this heading. */
function windOnRun(runDeg: number, windFromDeg: number, windKmh: number): string {
  if (windKmh === 0) return 'sans vent';
  const off = ((windFromDeg - runDeg + 540) % 360) - 180;
  if (Math.abs(off) <= 30) return 'face au vent';
  if (Math.abs(off) >= 150) return 'vent arrière';
  const side = off > 0 ? 'droite' : 'gauche';
  return Math.abs(off) < 70 ? `vent de trois-quarts ${side}` : `vent de travers ${side}`;
}

/** Rough freefall time from an exit to a pull at 1000 m, s: about 10 s to get up to speed, then 53 m/s. */
function freefallSeconds(exitHeight: number): number {
  const fall = exitHeight - 1000;
  return fall <= 300 ? fall / 30 : 10 + (fall - 300) / 53;
}

const ARROW = '<path d="M 0 16 L 0 -18 M -6 -11 L 0 -19 L 6 -11" fill="none" stroke-linecap="round" stroke-linejoin="round" />';

/** A small arrow pointing where the wind goes, for the summary card. */
const windArrow = (fromDeg: number, calm: boolean): string =>
  `<svg class="arrow" viewBox="-20 -20 40 40" style="transform:rotate(${fromDeg + 180}deg);opacity:${calm ? 0.3 : 1}"><path d="M 0 14 L 0 -14 M -6 -8 L 0 -15 L 6 -8" /></svg>`;

/** A compass rose with the wind and, optionally, jump run on it. */
class Compass {
  readonly el = h('div', 'compass');
  private readonly wind: SVGElement;
  private readonly run: SVGElement;

  constructor() {
    this.el.innerHTML = `
      <svg viewBox="-30 -30 60 60">
        <circle r="27" class="ring" />
        <text y="-18.5" text-anchor="middle">N</text>
        <g class="run">
          <path class="track" d="M 0 24 L 0 -16" />
          <path d="M -5 -14 L 0 -23 L 5 -14 Z" />
        </g>
        <g class="wind">${ARROW}</g>
      </svg>`;
    this.wind = this.el.querySelector('.wind')!;
    this.run = this.el.querySelector('.run')!;
  }

  set(windFromDeg: number, windKmh: number, runDeg: number | null = null): void {
    // The arrow shows where the air goes, as the windsock does.
    this.wind.setAttribute('transform', `rotate(${windFromDeg + 180})`);
    this.wind.style.opacity = windKmh === 0 ? '0.25' : '1';
    this.run.style.display = runDeg === null ? 'none' : '';
    if (runDeg !== null) this.run.setAttribute('transform', `rotate(${runDeg})`);
  }
}

/** Hints at the foot of a screen, for the keyboard and for the gamepad. */
function hints(keys: string, pad: string): HTMLElement {
  const p = h('p', 'hints');
  p.innerHTML = `<span class="keys">${keys}</span><span class="pad">${pad}</span>`;
  return p;
}

const PAD = (b: string): string => `<i class="btn">${b}</i>`;

interface RowOptions {
  /** Small text after the label. */
  hint?: string;
  /** Shown on the right of the label. */
  value?: () => string;
  /** A line under the control. */
  note?: () => string;
  disabled?: () => boolean;
}

// ---------------------------------------------------------------- menu

export class Menu {
  isOpen = false;
  /** Called with the chosen setup when the jump starts. */
  onStart: (setup: Setup, start: Start) => void = () => {};
  /** Called when the menu is closed without starting a new jump. */
  onCancel: () => void = () => {};
  /** Called when the drop zone, the hour or the weather change, to show them behind the menu. */
  onPreview: (setup: Setup) => void = () => {};
  /** Called when a setting changes: it is already in the settings object. */
  onSettings: () => void = () => {};

  private readonly root: HTMLElement;
  private readonly panel = h('div', 'panel');
  private readonly nav: Nav;
  private readonly setup: Setup;
  private readonly screens = new Map<ScreenId, HTMLElement>();
  private readonly cards = new Map<Category, HTMLButtonElement>();
  private readonly updaters: (() => void)[] = [];
  private screen: ScreenId = 'home';
  private canCancel = false;
  private readonly resume = button('resume', 'Reprendre le saut');
  private readonly jump = button('jump');
  private readonly cornerSettings = button('corner-btn');
  private readonly cornerLogbook = button('corner-btn');
  private readonly logbookBody = h('div', 'body logbook');
  private clearArmed = 0;

  constructor(
    initial: Setup,
    private readonly settings: Settings,
  ) {
    this.setup = cloneSetup(initial);
    const root = document.getElementById('menu');
    if (!root) throw new Error('missing #menu');
    this.root = root;
    this.nav = new Nav(
      root,
      {
        back: () => this.back(),
        start: () => this.go(),
        tab: (step) => this.tab(step),
        shortcut: (b) => this.toggleScreen(b === 'x' ? 'logbook' : 'settings'),
      },
      () => this.isOpen,
    );
    this.nav.onPadChange = (pad) => this.root.classList.toggle('pad', pad);

    this.screens.set('home', this.buildHome());
    this.screens.set('gear', this.buildGear());
    this.screens.set('dz', this.buildDz());
    this.screens.set('weather', this.buildWeather());
    this.screens.set('jump', this.buildJump());
    this.screens.set('settings', this.buildSettings());
    this.screens.set('logbook', this.buildLogbook());
    for (const s of this.screens.values()) this.panel.append(s);

    const corner = h('div', 'menu-corner');
    this.cornerLogbook.innerHTML = `${ICON_BOOK}<span>Carnet</span><i class="btn pad">X</i>`;
    this.cornerSettings.innerHTML = `${ICON_COG}<span>Réglages</span><i class="btn pad">Y</i>`;
    this.cornerLogbook.title = 'Carnet de sauts et statistiques';
    this.cornerSettings.title = 'Réglages : qualité, son, souris, touches';
    this.cornerLogbook.addEventListener('click', () => this.toggleScreen('logbook'));
    this.cornerSettings.addEventListener('click', () => this.toggleScreen('settings'));
    corner.append(this.nav.add(this.cornerLogbook), this.nav.add(this.cornerSettings));
    root.replaceChildren(this.panel, corner);

    window.addEventListener('keydown', (e) => this.key(e));
    this.show('home');
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
    this.nav.holdUntilReleased();
    this.show('home', canCancel ? this.resume : this.jump);
  }

  /** Whether the jump under way can still be resumed: not once it has moved to another drop zone. */
  setResumable(canCancel: boolean): void {
    this.canCancel = canCancel;
    this.root.classList.toggle('resumable', canCancel);
    if (!canCancel && this.nav.current === this.resume) this.nav.focus(this.jump, false);
  }

  /** Closes the menu and goes back to the jump under way, if there is one. */
  cancel(): void {
    if (!this.isOpen || !this.canCancel) return;
    saveSetup(this.setup);
    this.close();
    this.onCancel();
  }

  /** Reads the gamepad. Call every frame. */
  poll(): void {
    this.nav.poll();
  }

  /** Shows settings changed from the keyboard in flight. */
  refresh(): void {
    for (const update of this.updaters) update();
    this.nav.refresh();
  }

  // ------------------------------------------------------------ moving around

  private show(id: ScreenId, focus?: HTMLElement | null): void {
    const from = this.screen;
    this.screen = id;
    for (const [key, el] of this.screens) el.hidden = key !== id;
    this.cornerSettings.classList.toggle('on', id === 'settings');
    this.cornerLogbook.classList.toggle('on', id === 'logbook');
    if (id === 'logbook') this.fillLogbook();
    this.refresh();
    const screen = this.screens.get(id)!;
    screen.querySelector('.body')?.scrollTo(0, 0);
    let target = focus ?? null;
    if (!target && id === 'home') {
      // Back home, the focus goes back to where the screen just left was opened from.
      const opener = from === 'settings' ? this.cornerSettings : from === 'logbook' ? this.cornerLogbook : null;
      target = this.cards.get(from as Category) ?? opener ?? (this.canCancel ? this.resume : this.jump);
    }
    // Elsewhere it goes to the first line, not to the back button.
    target ??= screen.querySelector<HTMLElement>('.body [data-nav]:not(.disabled)');
    this.nav.setScreen(screen, target);
  }

  private back(): void {
    if (this.screen === 'home') this.cancel();
    else this.show('home');
  }

  private toggleScreen(id: 'settings' | 'logbook'): void {
    this.show(this.screen === id ? 'home' : id);
  }

  /** The category before or after, from a category screen. */
  private tab(step: -1 | 1): void {
    const i = CATEGORIES.findIndex((c) => c.id === this.screen);
    if (i < 0) return;
    this.show(CATEGORIES[(i + step + CATEGORIES.length) % CATEGORIES.length]!.id);
  }

  private close(): void {
    this.isOpen = false;
    this.root.style.display = 'none';
    (document.activeElement as HTMLElement | null)?.blur();
  }

  /** Starts the jump: from where the setup says, or from `start`, which it then remembers. */
  private go(start?: Start): void {
    if (start) this.setup.jump.start = start;
    saveSetup(this.setup);
    this.close();
    this.onStart(this.current, this.setup.jump.start);
  }

  private key(e: KeyboardEvent): void {
    if (!this.isOpen || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const start = START_KEYS[e.code];
    if (start) {
      e.preventDefault();
      this.go(start);
    }
  }

  // ------------------------------------------------------------ changes

  private changedScenery(): void {
    this.refresh();
    this.onPreview(this.current);
  }

  private setDz(dz: DzId): void {
    if (dz === this.setup.dz) return;
    this.setup.dz = dz;
    // Each place comes with the wind it usually gets.
    this.setup.weather = usualWeather(dz, this.setup.weather.sky);
    this.changedScenery();
  }

  private setHour(hour: number): void {
    this.setup.hour = clamp(Math.round(hour * 4) / 4, HOUR_MIN, HOUR_MAX);
    this.changedScenery();
  }

  private setWeather(change: Partial<Weather>): void {
    Object.assign(this.setup.weather, change);
    const w = this.setup.weather;
    w.windFromDeg = validHeading(w.windFromDeg);
    w.windKmh = clamp(Math.round(w.windKmh), 0, WIND_MAX_KMH);
    this.changedScenery();
  }

  private setGear(change: Partial<Gear>): void {
    const gear = this.setup.gear;
    Object.assign(gear, change);
    gear.exitWeightKg = validWeight(gear.exitWeightKg);
    // The other kind may not come in this size: take the nearest it has.
    gear.canopyAreaFt2 = nearestSize(gear.kind, gear.canopyAreaFt2);
    this.refresh();
  }

  private setJump(change: Partial<JumpPlan>): void {
    const plan = this.setup.jump;
    Object.assign(plan, change);
    plan.exitHeight = validExitHeight(plan.exitHeight);
    if (plan.runDeg !== null) plan.runDeg = validHeading(plan.runDeg);
    this.refresh();
  }

  private setSettings(change: Partial<Settings>): void {
    Object.assign(this.settings, change);
    this.refresh();
    this.onSettings();
  }

  // ------------------------------------------------------------ rows

  /** A setting on its own line: label, value, control, note. */
  private row(label: string, o: RowOptions & { adjust?: (step: -1 | 1, big: boolean) => void; activate?: () => void }, ...content: HTMLElement[]): HTMLElement {
    const head = h('div', 'head', h('span', 'label', label));
    if (o.hint) head.append(h('span', 'hint', o.hint));
    const value = h('b', 'value');
    head.append(value);
    const note = h('p', 'note');
    const row = h('div', 'row', head, ...content, note);
    this.nav.add(row, { adjust: o.adjust, activate: o.activate, disabled: o.disabled });
    this.updaters.push(() => {
      value.textContent = o.value?.() ?? '';
      note.textContent = o.note?.() ?? '';
      note.hidden = !note.textContent;
    });
    return row;
  }

  /** A row of buttons, one of them lit; left and right move the light. */
  private choice<T>(
    label: string,
    options: Option<T>[] | (() => Option<T>[]),
    get: () => T,
    set: (value: T) => void,
    o: RowOptions & { cls?: string } = {},
  ): HTMLElement {
    const box = h('div', `choices ${o.cls ?? ''}`);
    let offered: Option<T>[] = [];
    let key = '';
    const offer = (): void => {
      const list = typeof options === 'function' ? options() : options;
      const k = list.map((x) => `${String(x.value)}:${x.label}`).join('|');
      if (k === key) return;
      key = k;
      offered = list;
      box.replaceChildren(
        ...list.map((x) => {
          const b = button('');
          if (x.html) {
            b.innerHTML = x.html;
            b.title = x.label;
          } else b.textContent = x.label;
          b.tabIndex = -1;
          b.addEventListener('click', () => {
            if (!o.disabled?.()) set(x.value);
          });
          return b;
        }),
      );
    };
    offer();
    const adjust = (step: -1 | 1): void => {
      const i = offered.findIndex((x) => x.value === get());
      const j = clamp((i < 0 ? 0 : i) + step, 0, offered.length - 1);
      if (j !== i) set(offered[j]!.value);
    };
    const row = this.row(label, { ...o, adjust }, box);
    this.updaters.push(() => {
      offer();
      const current = get();
      [...box.children].forEach((b, i) => b.classList.toggle('on', offered[i]!.value === current));
    });
    return row;
  }

  /** A slider; left and right step it, more with Shift. */
  private slider(
    label: string,
    range: { min: number; max: number; step: number; big: number },
    get: () => number,
    set: (value: number) => void,
    o: RowOptions = {},
    beside?: HTMLElement,
  ): HTMLElement {
    const input = h('input');
    input.type = 'range';
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.tabIndex = -1;
    input.addEventListener('input', () => set(Number(input.value)));
    const control = beside ? h('div', 'beside', beside, input) : input;
    const adjust = (step: -1 | 1, big: boolean): void =>
      set(clamp(get() + step * (big ? range.big : range.step), range.min, range.max));
    const row = this.row(label, { ...o, adjust }, control);
    this.updaters.push(() => {
      input.value = String(get());
      input.disabled = !!o.disabled?.();
    });
    return row;
  }

  /** A line that does something when taken. */
  private action(label: string, act: () => void, o: RowOptions = {}): HTMLElement {
    const go = button('action', label);
    go.tabIndex = -1;
    go.addEventListener('click', act);
    const row = this.row('', { ...o, activate: act }, go);
    row.classList.add('action-row');
    return row;
  }

  // ------------------------------------------------------------ screens

  private screenShell(id: ScreenId, title: string | null): { screen: HTMLElement; body: HTMLElement } {
    const screen = h('section', `screen screen-${id}`);
    const bar = h('header', 'screen-bar');
    const back = button('back', '‹ Retour');
    back.addEventListener('click', () => this.show('home'));
    bar.append(this.nav.add(back));
    if (title) bar.append(h('h2', 'title', title));
    else {
      const tabs = h('nav', 'tabs');
      tabs.innerHTML = '<i class="btn pad">LB</i>';
      for (const c of CATEGORIES) {
        const t = button(c.id === id ? 'on' : '', c.title);
        t.tabIndex = -1;
        t.addEventListener('click', () => this.show(c.id));
        tabs.append(t);
      }
      tabs.insertAdjacentHTML('beforeend', '<i class="btn pad">RB</i>');
      bar.append(tabs);
    }
    const body = h('div', 'body');
    screen.append(bar, body);
    return { screen, body };
  }

  private detailHints(): HTMLElement {
    return hints(
      '↑ ↓ choisir la ligne · ← → régler (Maj : plus vite) · Tab catégorie suivante · Échap retour',
      `${PAD('↕')} ligne · ${PAD('↔')} régler · ${PAD('LB')} ${PAD('RB')} catégorie · ${PAD('B')} retour · ${PAD('Start')} sauter`,
    );
  }

  private buildHome(): HTMLElement {
    const screen = h('section', 'screen screen-home');
    const head = h('header', 'title-bar', h('h1', '', 'jumpsim'), h('p', '', 'pilotage sous voile'));
    const grid = h('div', 'cards');
    for (const c of CATEGORIES) {
      const sum = h('div', 'sum');
      const card = button(`cat-card cat-${c.id}`, h('span', 'cat', c.title), sum, h('span', 'more', 'Modifier ›'));
      card.addEventListener('click', () => this.show(c.id));
      this.cards.set(c.id, card);
      grid.append(this.nav.add(card));
      this.updaters.push(() => (sum.innerHTML = this.summary(c.id)));
    }
    this.resume.addEventListener('click', () => this.cancel());
    this.jump.addEventListener('click', () => this.go());
    this.updaters.push(() => {
      const { start, exitHeight } = this.setup.jump;
      const info = dzInfo(this.setup.dz);
      this.jump.innerHTML =
        start === 'plane'
          ? `Sauter<span>${num(exitHeight)} m</span>`
          : `Partir<span>${start === 'pattern' ? `en circuit · ${info.starts.pattern} m` : `en finale · ${info.starts.final} m`}</span>`;
    });
    const go = h('div', 'go', this.nav.add(this.resume), this.nav.add(this.jump));
    screen.append(
      head,
      grid,
      go,
      hints(
        'Clic, ou flèches et Entrée · 1 circuit · 2 finale · 3 avion<span class="resume-hint"> · Échap reprendre</span>',
        `${PAD('A')} choisir · ${PAD('Start')} sauter<span class="resume-hint"> · ${PAD('B')} reprendre</span> · ${PAD('X')} carnet · ${PAD('Y')} réglages`,
      ),
    );
    return screen;
  }

  /** What a home card says. */
  private summary(c: Category): string {
    const { dz, hour, weather, gear, jump } = this.setup;
    const info = dzInfo(dz);
    switch (c) {
      case 'gear': {
        const rig = rigFor(gear);
        const kind = gear.kind === 'classic' ? 'classique' : 'tri-cell';
        const alti = gear.altimeter === 'none' ? 'Sans altimètre' : `Altimètre ${gear.altimeter === 'analog' ? 'à aiguille' : 'digital'}`;
        return `
          <span class="big">${gear.canopyAreaFt2} ft² <small>${kind}</small>${swatch(gear.color)}</span>
          <span>${gear.exitWeightKg} kg · ${num(rig.wingLoading, 2)} lb/ft² · ${loadingLabel(rig.wingLoading)}</span>
          <span class="dim">${alti} · ${gear.audible ? 'altison' : 'sans altison'} · glisseur ${SLIDERS.find((o) => o.value === gear.slider)!.label.toLowerCase()}${gear.rsl ? ' · RSL' : ''}</span>`;
      }
      case 'dz': {
        return `
          <span class="big">${info.name}</span>
          <span>${info.note}</span>
          <span class="dim">Vent habituel du ${heading(info.wind.fromDeg)}, ${Math.round(info.wind.speed * 3.6)} km/h</span>`;
      }
      case 'weather': {
        const sky = SKIES.find((s) => s.value === weather.sky)!.label;
        const sun = sunPosition(info.lat, info.lon, hour, info.utcOffsetH);
        const gust = gustPeakKmh(weather);
        const wind =
          weather.windKmh === 0
            ? 'Vent calme'
            : `Vent du ${heading(weather.windFromDeg)} (${compassPoint(weather.windFromDeg)}) · ${weather.windKmh} km/h${gust > weather.windKmh ? `, rafales ${gust}` : ''}`;
        return `
          <span class="big">${formatHour(hour)} · ${sky}</span>
          <span class="wind">${windArrow(weather.windFromDeg, weather.windKmh === 0)}${wind}</span>
          <span class="dim">Soleil ${weather.sky === 'overcast' ? 'caché' : `à ${num(Math.max(0, sun.elevationDeg))}°, ${sunOnFinal(sun.azimuthDeg, landingHeading(info, weather.windFromDeg))}`}</span>`;
      }
      case 'jump': {
        if (jump.start !== 'plane') {
          const spot = jump.start === 'pattern' ? info.starts.pattern : info.starts.final;
          return `
            <span class="big">${START_NAMES[jump.start]} · ${spot} m</span>
            <span>Départ sous voile, ${jump.start === 'pattern' ? 'au début de la vent arrière' : 'en finale'}</span>
            <span class="dim">Pas d'avion ni de chute</span>`;
        }
        const run = runHeading(this.setup);
        const aloft = Math.round(weather.windKmh * windGradient(jump.exitHeight));
        return `
          <span class="big">Avion · ${num(jump.exitHeight)} m</span>
          <span>Axe ${heading(run)}, ${windOnRun(run, weather.windFromDeg, weather.windKmh)}</span>
          <span class="dim">Vent en altitude ${aloft} km/h · environ ${Math.round(freefallSeconds(jump.exitHeight))} s de chute</span>`;
      }
    }
  }

  private buildGear(): HTMLElement {
    const { screen, body } = this.screenShell('gear', null);
    const gear = (): Gear => this.setup.gear;
    body.append(
      this.choice<CanopyKind>(
        'VOILE',
        (Object.keys(CANOPY_SIZES) as CanopyKind[]).map((k) => ({ value: k, label: KIND_NAMES[k] })),
        () => gear().kind,
        (kind) => this.setGear({ kind }),
        { note: () => (gear().kind === 'classic' ? 'Voile 9 caissons classique, de l\'école au swoop.' : 'Voile tri-cell croisée : petite, rapide, pour le swoop.') },
      ),
      this.choice<number>(
        'TAILLE',
        () => CANOPY_SIZES[gear().kind].map((s) => ({ value: s, label: String(s) })),
        () => gear().canopyAreaFt2,
        (canopyAreaFt2) => this.setGear({ canopyAreaFt2 }),
        { hint: 'ft²', value: () => `${gear().canopyAreaFt2} ft²`, cls: 'sizes' },
      ),
      this.choice<CanopyColorId>(
        'COULEUR',
        (Object.keys(CANOPY_COLORS) as CanopyColorId[]).map((id) => ({ value: id, label: CANOPY_COLORS[id].name, html: swatch(id) })),
        () => gear().color,
        (color) => this.setGear({ color }),
        { value: () => CANOPY_COLORS[gear().color].name, cls: 'colors' },
      ),
      this.slider(
        'POIDS ÉQUIPÉ',
        { min: WEIGHT_MIN, max: WEIGHT_MAX, step: 1, big: 5 },
        () => gear().exitWeightKg,
        (exitWeightKg) => this.setGear({ exitWeightKg }),
        {
          hint: 'toi et tout le matériel',
          value: () => `${gear().exitWeightKg} kg`,
          note: () => {
            const rig = rigFor(gear());
            const { forward, sink } = trimSpeeds(rig);
            return `Charge alaire ${num(rig.wingLoading, 2)} lb/ft² (${loadingLabel(rig.wingLoading)}) · bras hauts ${num(forward * 3.6)} km/h, chute ${num(sink, 1)} m/s, finesse ${num(forward / sink, 1)}`;
          },
        },
      ),
      this.choice<AltimeterKind>('ALTIMÈTRE', ALTIMETERS, () => gear().altimeter, (altimeter) => this.setGear({ altimeter })),
      this.choice<boolean>('ALTISON', YES_NO, () => gear().audible, (audible) => this.setGear({ audible }), {
        hint: 'bips sous voile à 300, 200 et 100 m',
      }),
      this.choice<SliderKind>('GLISSEUR', SLIDERS, () => gear().slider, (slider) => this.setGear({ slider }), {
        note: () => SLIDER_NOTES[gear().slider],
      }),
      this.choice<boolean>('RSL', YES_NO, () => gear().rsl, (rsl) => this.setGear({ rsl }), {
        hint: 'la libération tire le secours',
        note: () =>
          `Secours ${reserveSize(gear().exitWeightKg)} ft², 7 caissons. ${
            gear().rsl ? 'Libérer (X maintenu) ouvre le secours tout seul.' : 'Après la libération, Espace pour tirer la poignée de secours.'
          }`,
      }),
    );
    screen.append(this.detailHints());
    return screen;
  }

  private buildDz(): HTMLElement {
    const { screen, body } = this.screenShell('dz', null);
    const list = h('div', 'dzs');
    for (const d of DZS) {
      const check = h('i', 'check', '✓');
      const card = button('dz', h('b', '', d.name), h('span', '', d.note), check);
      card.addEventListener('click', () => this.setDz(d.id));
      list.append(this.nav.add(card));
      this.updaters.push(() => {
        const on = this.setup.dz === d.id;
        // The real ones come with megabytes of photos: loaded when first chosen.
        const loading = on && !d.loaded();
        card.classList.toggle('on', on);
        card.classList.toggle('loading', loading);
        check.textContent = loading ? 'chargement…' : '✓';
      });
    }
    const note = h('p', 'note');
    const credit = h('p', 'note credit');
    this.updaters.push(() => {
      const info = dzInfo(this.setup.dz);
      note.textContent = `Vent habituel à ${info.name} : du ${heading(info.wind.fromDeg)}, ${Math.round(info.wind.speed * 3.6)} km/h. Changer de DZ remet la météo à ce vent.`;
      credit.textContent = info.credit ?? '';
    });
    body.append(list, note, credit);
    screen.append(
      hints(
        '↑ ↓ choisir · Entrée prendre cette DZ · Tab catégorie suivante · Échap retour',
        `${PAD('↕')} choisir · ${PAD('A')} prendre · ${PAD('LB')} ${PAD('RB')} catégorie · ${PAD('B')} retour · ${PAD('Start')} sauter`,
      ),
    );
    return screen;
  }

  private buildWeather(): HTMLElement {
    const { screen, body } = this.screenShell('weather', null);
    const w = (): Weather => this.setup.weather;
    const compass = new Compass();
    this.updaters.push(() => compass.set(w().windFromDeg, w().windKmh));
    body.append(
      this.slider('HEURE', { min: HOUR_MIN, max: HOUR_MAX, step: 0.25, big: 1 }, () => this.setup.hour, (hour) => this.setHour(hour), {
        hint: 'heure locale, début juillet',
        value: () => formatHour(this.setup.hour),
        note: () => {
          const info = dzInfo(this.setup.dz);
          const sun = sunPosition(info.lat, info.lon, this.setup.hour, info.utcOffsetH);
          const hidden = w().sky === 'overcast' ? ' (derrière les nuages)' : '';
          return `Soleil à ${num(Math.max(0, sun.elevationDeg))}° au-dessus de l'horizon, ${sunOnFinal(sun.azimuthDeg, landingHeading(info, w().windFromDeg))}${hidden}`;
        },
      }),
      this.choice<SkyKind>('CIEL', SKIES, () => w().sky, (sky) => this.setWeather({ sky })),
      this.slider(
        'DIRECTION DU VENT',
        { min: 0, max: 355, step: 5, big: 45 },
        () => w().windFromDeg,
        (windFromDeg) => this.setWeather({ windFromDeg }),
        { value: () => `du ${heading(w().windFromDeg)} (${compassPoint(w().windFromDeg)})` },
        compass.el,
      ),
      this.slider('FORCE DU VENT', { min: 0, max: WIND_MAX_KMH, step: 1, big: 5 }, () => w().windKmh, (windKmh) => this.setWeather({ windKmh }), {
        hint: 'à 10 m du sol',
        value: () => (w().windKmh === 0 ? 'calme' : `${w().windKmh} km/h`),
      }),
      this.choice<GustLevel>('RAFALES', GUSTS, () => w().gusts, (gusts) => this.setWeather({ gusts }), {
        value: () => {
          const gust = gustPeakKmh(w());
          return gust > w().windKmh ? `jusqu'à ${gust} km/h` : '';
        },
      }),
      this.action('Vent habituel de la DZ', () => this.setWeather(usualWeather(this.setup.dz, w().sky)), {
        note: () => {
          const info = dzInfo(this.setup.dz);
          return `${info.name} : du ${heading(info.wind.fromDeg)}, ${Math.round(info.wind.speed * 3.6)} km/h, sans rafales`;
        },
      }),
    );
    screen.append(this.detailHints());
    return screen;
  }

  private buildJump(): HTMLElement {
    const { screen, body } = this.screenShell('jump', null);
    const plan = (): JumpPlan => this.setup.jump;
    const noPlane = (): boolean => plan().start !== 'plane';
    const compass = new Compass();
    this.updaters.push(() => compass.set(this.setup.weather.windFromDeg, this.setup.weather.windKmh, runHeading(this.setup)));
    body.append(
      this.choice<Start>(
        'DÉPART',
        (['plane', 'pattern', 'final'] as const).map((s) => ({ value: s, label: START_NAMES[s] })),
        () => plan().start,
        (start) => this.setJump({ start }),
        {
          note: () => {
            const info = dzInfo(this.setup.dz);
            if (plan().start === 'pattern') return `Sous voile à ${info.starts.pattern} m, au début de la vent arrière.`;
            if (plan().start === 'final') return `Sous voile à ${info.starts.final} m, en finale.`;
            return 'Sortie d\'avion, chute libre, ouverture, puis le vol sous voile.';
          },
        },
      ),
      this.slider(
        'ALTITUDE DE LARGAGE',
        { min: EXIT_HEIGHT_MIN, max: EXIT_HEIGHT_MAX, step: EXIT_HEIGHT_STEP, big: 500 },
        () => plan().exitHeight,
        (exitHeight) => this.setJump({ exitHeight }),
        {
          hint: 'au-dessus de la DZ',
          value: () => `${num(plan().exitHeight)} m`,
          note: () => {
            const exit = plan().exitHeight;
            if (exit <= 1500) return 'Hop & pop : ouvre presque tout de suite.';
            return `Environ ${Math.round(freefallSeconds(exit))} s de chute libre pour ouvrir à 1 000 m.`;
          },
          disabled: noPlane,
        },
      ),
      this.choice<boolean>(
        'AXE DE LARGAGE',
        [
          { value: true, label: 'Face au vent' },
          { value: false, label: 'Au choix' },
        ],
        () => plan().runDeg === null,
        (intoWind) => this.setJump({ runDeg: intoWind ? null : this.setup.weather.windFromDeg }),
        { disabled: noPlane },
      ),
      this.slider(
        'CAP DE L\'AVION',
        { min: 0, max: 355, step: 5, big: 45 },
        () => runHeading(this.setup),
        (runDeg) => this.setJump({ runDeg: validHeading(runDeg) }),
        {
          value: () => `${heading(runHeading(this.setup))} (${compassPoint(runHeading(this.setup))})`,
          note: () => {
            const { weather } = this.setup;
            const aloft = Math.round(weather.windKmh * windGradient(plan().exitHeight));
            return `${windOnRun(runHeading(this.setup), weather.windFromDeg, weather.windKmh)} · vent à ${num(plan().exitHeight)} m : ${aloft} km/h du ${heading(weather.windFromDeg)} · la cible passe côté porte, à gauche`;
          },
          disabled: () => noPlane() || plan().runDeg === null,
        },
        compass.el,
      ),
      this.choice<MalfunctionRate>('INCIDENT À L\'OUVERTURE', MALFUNCTIONS, () => plan().malfunction, (malfunction) => this.setJump({ malfunction }), {
        note: () =>
          plan().malfunction === 'none'
            ? 'La principale s\'ouvre toujours bien.'
            : 'La principale peut partir en torche : X maintenu pour libérer, puis le secours.',
        disabled: noPlane,
      }),
    );
    screen.append(this.detailHints());
    return screen;
  }

  private buildSettings(): HTMLElement {
    const { screen, body } = this.screenShell('settings', 'RÉGLAGES');
    const s = this.settings;
    body.append(
      h('h3', 'section', 'AFFICHAGE'),
      this.choice<number>(
        'QUALITÉ',
        QUALITY_LEVELS.map((q, i) => ({ value: i, label: q.label })),
        () => s.quality,
        (quality) => this.setSettings({ quality }),
        { note: () => 'Définition maximale de l\'image. Baisse-la si ça saccade. (G en vol)' },
      ),
      this.choice<boolean>('RÉSOLUTION AUTO', YES_NO, () => s.autoResolution, (autoResolution) => this.setSettings({ autoResolution }), {
        note: () => 'Baisse la définition toute seule quand les images par seconde chutent.',
      }),
      this.choice<boolean>('COMPTEUR D\'IMAGES', YES_NO, () => s.showFps, (showFps) => this.setSettings({ showFps }), {
        hint: 'en haut à gauche, en vol',
      }),
      this.choice<boolean>('TOUCHES À L\'ÉCRAN', YES_NO, () => s.showKeys, (showKeys) => this.setSettings({ showKeys }), {
        hint: 'sur le côté, en vol · K',
      }),
      h('h3', 'section', 'AUDIO'),
      this.choice<boolean>('SON', YES_NO, () => s.sound, (sound) => this.setSettings({ sound }), { hint: 'M en vol' }),
      this.slider('VOLUME', { min: 0, max: 100, step: 5, big: 20 }, () => Math.round(s.volume * 100), (v) => this.setSettings({ volume: v / 100 }), {
        value: () => `${Math.round(s.volume * 100)} %`,
        disabled: () => !s.sound,
      }),
      h('h3', 'section', 'CONTRÔLES'),
      this.slider(
        'SENSIBILITÉ DE LA SOURIS',
        { min: SENSITIVITY_MIN, max: SENSITIVITY_MAX, step: 0.1, big: 0.5 },
        () => s.mouseSensitivity,
        (v) => this.setSettings({ mouseSensitivity: Math.round(v * 10) / 10 }),
        { value: () => `${num(s.mouseSensitivity, 1)}×` },
      ),
      this.choice<boolean>('REGARD INVERSÉ', YES_NO, () => s.invertLook, (invertLook) => this.setSettings({ invertLook }), {
        hint: 'souris et stick droit',
      }),
      h('h3', 'section', 'TOUCHES'),
      this.nav.add(this.controlsTable()),
    );
    screen.append(
      hints(
        '↑ ↓ choisir la ligne · ← → régler · Échap retour',
        `${PAD('↕')} ligne · ${PAD('↔')} régler · ${PAD('B')} retour`,
      ),
    );
    return screen;
  }

  private controlsTable(): HTMLElement {
    const rows: [string, string, string][] = [
      ['Commande gauche / droite', 'Q / D', 'gâchettes LT / RT'],
      ['Les deux commandes (frein, arrondi)', 'S', 'les deux gâchettes'],
      ['Élévateur avant gauche / droit', 'A / E', 'LB / RB'],
      ['Les deux élévateurs avant', 'Z', 'LB + RB'],
      ['Garder les commandes où elles sont', 'Maj', '—'],
      ['Regarder autour', 'souris · C recentre', 'stick droit'],
      ['Sauter de l\'avion, puis ouvrir', 'Espace', 'A'],
      ['Glisseur : le replier ou l\'enlever', 'G', 'X'],
      ['Libérer la principale (maintenir)', 'X', 'B'],
      ['Poignée de secours, une fois libéré', 'Espace', 'A'],
      ['Caméra : yeux / extérieure (molette : distance)', 'B', 'View'],
      ['En chute : tourner', 'Q / D', 'gâchettes'],
      ['En chute : avancer, reculer, glisser', 'Z / S · A / E', 'stick gauche'],
      ['En chute : monter / descendre', 'R / F', 'LB / RB'],
      ['En chute : assis / tête en bas', '↑ / ↓', 'croix haut / bas'],
      ['En chute : à plat / dos', '← / →', 'croix gauche / droite'],
      ['Recommencer (pas en chute)', 'R', 'Y'],
      ['Partir en circuit / finale / avion', '1 / 2 / 3', '—'],
      ['Menu', 'V ou Échap', 'Start'],
      ['Masquer l\'affichage · pause', 'H · P', '—'],
      ['Son · touches à l\'écran', 'M · K', '—'],
    ];
    const table = h('table', 'controls');
    table.innerHTML = `<thead><tr><th></th><th>Clavier</th><th>Manette</th></tr></thead><tbody>${rows
      .map(([what, keys, pad]) => `<tr><td>${what}</td><td>${keys}</td><td>${pad}</td></tr>`)
      .join('')}</tbody>`;
    return h('div', 'row table-row', table);
  }

  private buildLogbook(): HTMLElement {
    const screen = h('section', 'screen screen-logbook');
    const bar = h('header', 'screen-bar');
    const back = button('back', '‹ Retour');
    back.addEventListener('click', () => this.show('home'));
    bar.append(this.nav.add(back), h('h2', 'title', 'CARNET DE SAUTS'));
    screen.append(
      bar,
      this.logbookBody,
      hints('↑ ↓ parcourir · Échap retour', `${PAD('↕')} parcourir · ${PAD('B')} retour`),
    );
    return screen;
  }

  /** Reads the logbook again and lays it out. */
  private fillLogbook(): void {
    const entries = loadLogbook();
    const stats = logStats(entries);
    const body = this.logbookBody;
    body.replaceChildren();
    const time = (s: number): string => {
      const m = Math.floor(s / 60);
      return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min ${String(Math.round(s % 60)).padStart(2, '0')}`;
    };
    const tile = (value: string, label: string, sub = ''): string =>
      `<div class="tile"><b>${value}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const upright = stats.groups[0]! + stats.groups[1]!;
    const tiles = h('div', 'tiles');
    tiles.innerHTML = [
      tile(String(stats.jumps), stats.jumps > 1 ? 'sauts' : 'saut', `dont ${stats.planeJumps} d'avion`),
      tile(time(stats.freefallSeconds), 'de chute libre'),
      tile(time(stats.canopySeconds), 'sous voile'),
      tile(stats.jumps ? `${Math.round((100 * upright) / stats.jumps)} %` : '—', 'posés debout ou courus'),
      tile(stats.bestDistance === null ? '—' : `${num(stats.bestDistance)} m`, 'meilleure précision', stats.recentDistance === null ? '' : `${num(stats.recentDistance)} m en moyenne sur les 10 derniers`),
      tile(stats.lowestPull === null ? '—' : `${num(stats.lowestPull)} m`, 'ouverture la plus basse', stats.aadFires ? `déclencheur : ${stats.aadFires} fois` : ''),
    ].join('');
    body.append(tiles);

    if (stats.jumps) {
      const bar = h('div', 'outcomes');
      bar.innerHTML = `<div class="stack">${stats.groups
        .map((count, i) => (count ? `<i class="o${i}" style="flex:${count}"></i>` : ''))
        .join('')}</div><div class="legend">${OUTCOME_GROUPS.map(
        (g, i) => `<span><i class="o${i}"></i>${g.label} ${stats.groups[i]}</span>`,
      ).join('')}</div>`;
      body.append(bar);
    }

    body.append(h('h3', 'section', 'SAUTS'));
    if (!entries.length) {
      body.append(h('p', 'empty', 'Pas encore de saut. Chaque saut qui finit au sol s\'inscrit ici.'));
    }
    for (const e of [...entries].reverse()) body.append(this.nav.add(this.logRow(e)));

    if (entries.length) {
      const clear = button('action danger', 'Effacer le carnet');
      const act = (): void => {
        if (performance.now() < this.clearArmed) {
          clearLogbook();
          this.clearArmed = 0;
          this.fillLogbook();
          this.nav.setScreen(this.screens.get('logbook')!);
          return;
        }
        this.clearArmed = performance.now() + 4000;
        clear.textContent = 'Sûr ? Encore une fois pour tout effacer';
        setTimeout(() => (clear.textContent = 'Effacer le carnet'), 4000);
      };
      clear.tabIndex = -1;
      clear.addEventListener('click', act);
      const row = h('div', 'row action-row', clear);
      body.append(this.nav.add(row, { activate: act }));
    }
  }

  private logRow(e: LogEntry): HTMLElement {
    const date = new Date(e.time);
    const when = `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    const start = e.start === 'plane' && e.freefall ? `Avion ${num(e.freefall.exitHeight)} m` : START_NAMES[e.start];
    const canopy = `${e.canopy.areaFt2} ft²${e.canopy.kind === 'triCell' ? ' tri-cell' : ''} · ${e.canopy.exitWeightKg} kg`;
    const ff = e.freefall
      ? e.freefall.aad
        ? ` · déclencheur`
        : e.freefall.pullHeight !== null
          ? ` · ouvert à ${num(e.freefall.pullHeight)} m`
          : ''
      : '';
    const bad = e.outcome === 'hard' || e.outcome === 'crash' || e.outcome === 'impact';
    const result =
      e.outcome === 'impact'
        ? `${num(e.sink * 3.6)} km/h`
        : `${e.distance === undefined ? '' : `${num(e.distance)} m de la cible · `}${num(e.sink, 1)} m/s${e.wet ? ' · dans l\'eau' : ''}`;
    const row = h('div', 'row entry');
    row.innerHTML = `
      <span class="n">#${e.n}</span>
      <span class="what"><b>${e.dzName}</b> · ${start}${ff}<small>${when} · ${canopy} · vent ${e.weather.windKmh} km/h</small></span>
      <span class="res${bad ? ' bad' : ''}"><b>${OUTCOME_NAMES[e.outcome]}</b><small>${result}</small></span>`;
    return row;
  }
}

const ICON_COG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.1 4.4.1-.9-.1-.9 2-1.6-2-3.4-2.4.9a7.8 7.8 0 0 0-1.6-.9L15.8 3h-3.9l-.4 2.5c-.6.2-1.1.5-1.6.9l-2.4-.9-2 3.4 2 1.6-.1.9.1.9-2 1.6 2 3.4 2.4-.9c.5.4 1 .7 1.6.9l.4 2.5h3.9l.4-2.5c.6-.2 1.1-.5 1.6-.9l2.4.9 2-3.4-2-1.6Z"/></svg>';
const ICON_BOOK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5a1.5 1.5 0 0 0 0 3H19M8.5 7h7M8.5 10.5h7"/></svg>';
