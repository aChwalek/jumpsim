// The menu. The home screen sums up the jump in four cards (gear, drop zone,
// weather, jump); each opens its own screen to change it. The corner holds
// the language, the logbook and the settings. Beside the panel, the drop zone
// from above with the pattern and jump run the setup gives (dzMap.ts).
// Everything can be reached with the mouse, the keyboard or a gamepad (see
// nav.ts). What changes the scenery is shown at once behind the menu.
//
// Every word comes from the dictionary of the language in use (../i18n):
// changing the language builds the screens again.

import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import './menu.css';
import { LANGS, T, heading, lang, num, setLanguage, type Lang } from '../i18n';
import { HOUR_MAX, HOUR_MIN, formatHour, sunPosition } from '../render/daylight';
import { CANOPY_COLORS, type CanopyColorId } from '../render/canopyColors';
import { SMOKE_BURN, SMOKE_COLORS, SMOKE_KINDS, type SmokeColor, type SmokeKind } from '../render/smoke';
import { OUTFIT_COLORS, OUTFIT_COLOR_IDS, type OutfitColor } from '../render/outfit';
import { OUTCOME_GROUPS, clearLogbook, loadLogbook, logStats, type LogEntry } from '../logbook';
import { clearTracks, storedTracks, trackId } from '../replay/store';
import { PROGRESSIVE_RATE_MAX, PROGRESSIVE_RATE_MIN, QUALITY_LEVELS, SENSITIVITY_MAX, SENSITIVITY_MIN, type Settings } from '../settings';
import {
  CANOPY_SIZES,
  EXIT_HEIGHT_MAX,
  EXIT_HEIGHT_MIN,
  EXIT_HEIGHT_STEP,
  WEIGHT_MAX,
  WEIGHT_MIN,
  cloneSetup,
  kindName,
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
  type BotsPlan,
  type JumpPlan,
  type MalfunctionRate,
  type SliderKind,
  MALFUNCTION_ODDS,
  MALFUNCTION_RATES,
  SLIDER_KINDS,
  CONTAINERS,
  startsAt,
  suitOf,
  type Setup,
  type Start,
} from '../setup';
import { AIRCRAFT, EXIT_SPOTS, type ExitSpot } from '../sim/plane';
import { BOTS_MAX, BOT_LEADS, BOT_MODES, botHeights, leaderLed, type BotLead, type BotMode } from '../sim/bot';
import { SUIT_KINDS, SUIT_LEVELS, hasWings, suitGlide, type SuitKind, type SuitLevel } from '../sim/suit';
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
import { keyLabel } from '../input/keyLabels';
import { DzMap } from './dzMap';
import {
  ICON_BACK,
  ICON_BOOK,
  ICON_CANOPY,
  ICON_COG,
  ICON_DZ,
  ICON_GLOBE,
  ICON_LOCK,
  ICON_MORE,
  ICON_PEOPLE,
  ICON_PLANE,
  ICON_PLAY,
  ICON_WEATHER,
  LOGO,
} from './icons';
import { Nav } from './nav';
import { MAX_PEERS } from '../net/protocol';
import type { SharedSetup } from '../net/room';

export type { Start } from '../setup';

type Category = 'gear' | 'dz' | 'weather' | 'jump';
type ScreenId = 'home' | Category | 'settings' | 'logbook';

const CATEGORIES: { id: Category; icon: string }[] = [
  { id: 'gear', icon: ICON_CANOPY },
  { id: 'dz', icon: ICON_DZ },
  { id: 'weather', icon: ICON_WEATHER },
  { id: 'jump', icon: ICON_PLANE },
];

/** Screens the map stands beside. */
const WITH_MAP: ReadonlySet<ScreenId> = new Set<ScreenId>(['home', 'gear', 'dz', 'weather', 'jump']);

interface Option<T> {
  value: T;
  label: string;
  /** Markup in place of the label, such as a colour swatch. */
  html?: string;
}

/** Straight to a start from the menu, as in flight. */
const START_KEYS: Record<string, Start | undefined> = { Digit1: 'pattern', Digit2: 'final', Digit3: 'plane', Digit4: 'base' };

/** A small picture of each drop zone from above, for the list (tools/dz/thumbs.mjs makes them). */
const thumbUrl = (id: DzId): string => `${import.meta.env.BASE_URL}dz/thumbs/${id}.jpg`;

// ---------------------------------------------------------------- helpers

type Child = Node | string;

/** A new element with classes and children. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  node.append(...children);
  return node;
}

/** An element from markup. */
function html(markup: string): Element {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild!;
}

function button(cls: string, ...children: Child[]): HTMLButtonElement {
  const b = h('button', cls, ...children);
  b.type = 'button';
  return b;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const options = <V>(values: readonly V[], label: (v: V) => string): Option<V>[] => values.map((value) => ({ value, label: label(value) }));
const yesNo = (): Option<boolean>[] => [
  { value: false, label: T.no },
  { value: true, label: T.yes },
];

/** A colour swatch: the cells of the canopy side by side. */
const swatch = (id: CanopyColorId): string =>
  `<span class="swatch">${CANOPY_COLORS[id].cells
    .map((c) => `<i style="background:#${c.toString(16).padStart(6, '0')}"></i>`)
    .join('')}</span>`;

/** A round dot of a colour. */
const dot = (color: number): string => `<span class="smoke-dot" style="background:#${color.toString(16).padStart(6, '0')}"></span>`;

/** A round dot of the smoke's colour. */
const smokeDot = (color: SmokeColor): string => dot(SMOKE_COLORS[color]);

/** The colours a helmet or a jumpsuit comes in, as dots. */
const outfitChoices = (): Option<OutfitColor>[] =>
  OUTFIT_COLOR_IDS.map((id) => ({ value: id, label: T.menu.gear.outfitColors[id], html: dot(OUTFIT_COLORS[id]) }));

/** Where the sun is seen from final, flying this heading. */
function sunOnFinal(azimuthDeg: number, finalDeg: number): string {
  const off = ((azimuthDeg - finalDeg + 540) % 360) - 180;
  const where = T.menu.weather.sunOnFinal;
  if (Math.abs(off) < 50) return where.ahead;
  if (Math.abs(off) > 130) return where.behind;
  return off > 0 ? where.right : where.left;
}

/** How the wind meets a plane on this heading. */
function windOnRun(runDeg: number, windFromDeg: number, windKmh: number): string {
  const w = T.menu.jump.windOnRun;
  if (windKmh === 0) return w.calm;
  const off = ((windFromDeg - runDeg + 540) % 360) - 180;
  if (Math.abs(off) <= 30) return w.head;
  if (Math.abs(off) >= 150) return w.tail;
  return Math.abs(off) < 70 ? w.quarter(off > 0) : w.cross(off > 0);
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
        ${[0, 90, 180, 270].map((a) => `<path class="tick" transform="rotate(${a})" d="M 0 -27 L 0 -23" />`).join('')}
        <text y="-15.5" text-anchor="middle">N</text>
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

/** Gamepad buttons in a hint: {A} is drawn as the button. */
const padMarkup = (text: string): string => text.replace(/\{([^}]+)\}/g, '<i class="btn">$1</i>');

/** Hints at the foot of a screen, for the keyboard and for the gamepad. */
function hints(keys: string, pad: string): HTMLElement {
  const p = h('p', 'hints');
  p.innerHTML = `<span class="keys">${keys}</span><span class="pad">${padMarkup(pad)}</span>`;
  return p;
}

interface RowOptions {
  /** Small text after the label. */
  hint?: string;
  /** Shown on the right of the label. */
  value?: () => string;
  /** A line under the control. */
  note?: () => string;
  disabled?: () => boolean;
  /** Finds the row again once the screens are built anew. */
  key?: string;
}

// ---------------------------------------------------------------- menu

/** The room, as the home screen shows it. */
export interface RoomView {
  room: string;
  /** The address to give the others. */
  link: string;
  /** In the room: the server has said who is there. */
  online: boolean;
  isHost: boolean;
  hostName: string;
  ready: boolean;
  players: { name: string; ready: boolean; self: boolean; host: boolean }[];
  /** The drop zone whose public room this is; null for a room of one's own. */
  publicDz: DzId | null;
  /** In a public room, when the next load leaves (Date.now() clock, ms). */
  loadAt: number | null;
}

/** What the DZ, weather and jump cards are: set by whoever leads a room. */
const ICON_PEOPLE_EL = (): Element => html(ICON_PEOPLE);

const SHARED: ReadonlySet<ScreenId> = new Set<ScreenId>(['dz', 'weather', 'jump']);
/** Time to click again to start without everyone ready, ms. */
const ARM_MS = 4000;
/** How often the time to the next load is redrawn, ms. */
const TICK_MS = 250;

/** The time left until `at` (Date.now() clock, ms), as m:ss. */
function timeTo(at: number): string {
  const s = Math.max(0, Math.ceil((at - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Menu {
  isOpen = false;
  /** Called with the chosen setup when the jump starts. */
  onStart: (setup: Setup, start: Start) => void = () => {};
  /** Called when the menu is closed without starting a new jump. */
  onCancel: () => void = () => {};
  /** Called when the drop zone, the hour or the weather change, to show them behind the menu. */
  onPreview: (setup: Setup) => void = () => {};
  /** A jump of the logbook to watch again, from its track. */
  onWatch: (entry: LogEntry) => void = () => {};
  /** Called when a setting changes: it is already in the settings object. */
  onSettings: () => void = () => {};
  /** Called when anything the room shares changes (drop zone, hour, weather, jump). */
  onSetupChange: (setup: Setup) => void = () => {};
  onCreateRoom: () => void = () => {};
  /** Into the public room of the drop zone on the menu. */
  onJoinPublic: () => void = () => {};
  onLeaveRoom: () => void = () => {};
  onRename: () => void = () => {};
  /** In a room, the jump button: ready for the next jump, or no longer. */
  onReady: (ready: boolean) => void = () => {};
  /** Leading a room: everyone goes now, ready or not. */
  onStartNow: () => void = () => {};
  /** The drop zone from above, beside the panel. */
  readonly map = new DzMap();

  private readonly root: HTMLElement;
  private readonly nav: Nav;
  private readonly setup: Setup;
  private readonly screens = new Map<ScreenId, HTMLElement>();
  private readonly cards = new Map<Category, HTMLButtonElement>();
  private updaters: (() => void)[] = [];
  /** What shows the time to the next load: redrawn while it counts down. */
  private ticking: (() => void)[] = [];
  private screen: ScreenId = 'home';
  private canCancel = false;
  private panel!: HTMLElement;
  private resume!: HTMLButtonElement;
  private jump!: HTMLButtonElement;
  private cornerSettings!: HTMLButtonElement;
  private cornerLogbook!: HTMLButtonElement;
  private cornerLanguage!: HTMLButtonElement;
  private logbookBody!: HTMLElement;
  private clearArmed = 0;
  /** The last jump of the logbook watched again, to come back to its line. */
  private watched: string | null = null;
  private room: RoomView | null = null;
  /** How many are in the public room of the drop zone on the menu; null when not known. */
  private publicCount: number | null = null;
  private startArmed = 0;

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
    this.build();
    window.addEventListener('keydown', (e) => this.key(e));
    window.setInterval(() => {
      if (this.isOpen && this.room?.loadAt) for (const tick of this.ticking) tick();
    }, TICK_MS);
    this.show('home');
  }

  /** The setup as it stands in the menu. */
  get current(): Setup {
    return cloneSetup(this.setup);
  }

  /** `canCancel`: a jump is under way and can be resumed. `screen`: back to the logbook, after watching a jump of it. */
  open(canCancel: boolean, screen: 'home' | 'logbook' = 'home'): void {
    this.setResumable(canCancel);
    this.isOpen = true;
    this.root.style.display = 'flex';
    this.nav.holdUntilReleased();
    if (screen !== 'logbook') return this.show('home', canCancel ? this.resume : this.jump);
    this.show('logbook');
    // Back on the line of the jump just watched.
    const row = this.watched ? this.logbookBody.querySelector<HTMLElement>(`[data-track="${this.watched}"]`) : null;
    if (row) this.nav.focus(row, true);
  }

  /** Whether the jump under way can be resumed. */
  get resumable(): boolean {
    return this.canCancel;
  }

  /** Out of the way while a jump of the logbook is watched; `open` brings it back. */
  hide(): void {
    this.close();
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
    this.map.update(this.setup);
    this.nav.refresh();
  }

  /** Shows the room on the home screen; null when not in one. */
  setRoom(room: RoomView | null): void {
    this.room = room;
    // Not leading: the screens for what the room shares are not ours to open.
    if (this.isShut(this.screen)) this.show('home');
    else this.refresh();
  }

  /** How many are in the public room of the drop zone on the menu; null when not known. */
  setPublicCount(players: number | null): void {
    if (players === this.publicCount) return;
    this.publicCount = players;
    this.refresh();
  }

  /** What whoever leads the room set: taken as if chosen here, the gear apart. */
  applyShared(shared: SharedSetup): void {
    this.setup.dz = shared.dz;
    this.setup.hour = shared.hour;
    this.setup.weather = { ...shared.weather };
    this.setup.jump = { ...shared.jump };
    this.refresh();
    this.onPreview(this.current);
  }

  /** The room goes: with its setup, from where it says. */
  startShared(shared: SharedSetup, start: Start): void {
    this.applyShared(shared);
    this.go(start, true);
  }

  /** In a room and not leading it. */
  private get locked(): boolean {
    return this.room !== null && !this.room.isHost;
  }

  /**
   * Set by whoever leads the room, so not ours to open. A public room's drop
   * zone stays open: choosing another goes to that one's public room.
   */
  private isShut(id: ScreenId): boolean {
    return this.locked && SHARED.has(id) && !(id === 'dz' && this.room?.publicDz);
  }

  /** For the screenshots: straight to a screen. */
  debugShow(id: ScreenId): void {
    this.show(id);
  }

  /** Picks a drop zone as the DZ screen does. */
  chooseDz(id: DzId): void {
    this.setDz(id);
  }

  // ------------------------------------------------------------ building

  /** Builds every screen, in the language in use. */
  private build(): void {
    this.screens.clear();
    this.cards.clear();
    this.updaters = [];
    this.ticking = [];
    this.panel = h('div', 'panel');
    this.resume = button('resume', T.menu.resume);
    this.jump = button('jump');

    this.screens.set('home', this.buildHome());
    this.screens.set('gear', this.buildGear());
    this.screens.set('dz', this.buildDz());
    this.screens.set('weather', this.buildWeather());
    this.screens.set('jump', this.buildJump());
    this.screens.set('settings', this.buildSettings());
    this.logbookBody = h('div', 'body logbook');
    this.screens.set('logbook', this.buildLogbook());
    for (const s of this.screens.values()) this.panel.append(s);

    const corner = h('div', 'menu-corner');
    this.cornerLanguage = button('corner-btn lang');
    this.cornerLanguage.innerHTML = `${ICON_GLOBE}${LANGS.map((l) => `<span class="lang-opt${l === lang ? ' on' : ''}">${l.toUpperCase()}</span>`).join('')}`;
    this.cornerLanguage.title = T.menu.languageTitle;
    this.cornerLanguage.dataset.key = 'lang';
    this.cornerLanguage.addEventListener('click', () => this.setLanguage(LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]!));
    this.cornerLogbook = button('corner-btn');
    this.cornerSettings = button('corner-btn');
    this.cornerLogbook.innerHTML = `${ICON_BOOK}<span>${T.menu.logbook}</span><i class="btn pad">X</i>`;
    this.cornerSettings.innerHTML = `${ICON_COG}<span>${T.menu.settings}</span><i class="btn pad">Y</i>`;
    this.cornerLogbook.title = T.menu.logbookTitle;
    this.cornerSettings.title = T.menu.settingsTitle;
    this.cornerLogbook.addEventListener('click', () => this.toggleScreen('logbook'));
    this.cornerSettings.addEventListener('click', () => this.toggleScreen('settings'));
    corner.append(this.nav.add(this.cornerLanguage), this.nav.add(this.cornerLogbook), this.nav.add(this.cornerSettings));
    this.root.replaceChildren(this.panel, this.map.el, corner);
  }

  /** Switches the language and builds the screens again, where they were. */
  private setLanguage(next: Lang): void {
    if (next === lang) return;
    const key = (this.nav.current as HTMLElement | null)?.dataset.key;
    this.settings.language = next;
    setLanguage(next);
    this.build();
    this.onSettings();
    const again = key ? this.root.querySelector<HTMLElement>(`[data-key="${key}"]`) : null;
    this.show(this.screen, again);
  }

  // ------------------------------------------------------------ moving around

  private show(id: ScreenId, focus?: HTMLElement | null): void {
    if (this.isShut(id)) return;
    const from = this.screen;
    this.screen = id;
    for (const [key, el] of this.screens) el.hidden = key !== id;
    this.root.dataset.screen = id;
    this.map.setShown(WITH_MAP.has(id));
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

  /**
   * Starts the jump: from where the setup says, or from `start`, which it then
   * remembers. In a room, says ready or no longer; `now` when the room goes.
   */
  private go(start?: Start, now = false): void {
    if (this.room && !now) {
      if (this.locked) return this.onReady(!this.room.ready);
      if (start && start !== this.setup.jump.start) {
        this.setup.jump.start = start;
        this.changedSetup();
      }
      return this.onReady(start ? true : !this.room.ready);
    }
    if (start) this.setup.jump.start = start;
    saveSetup(this.setup);
    this.close();
    this.onStart(this.current, this.setup.jump.start);
  }

  private key(e: KeyboardEvent): void {
    if (!this.isOpen || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const start = START_KEYS[e.code];
    if (start && startsAt(this.setup.dz).includes(start)) {
      e.preventDefault();
      this.go(start);
    }
  }

  // ------------------------------------------------------------ changes

  private changedScenery(): void {
    this.refresh();
    this.onPreview(this.current);
    this.onSetupChange(this.current);
  }

  private changedSetup(): void {
    this.refresh();
    this.onSetupChange(this.current);
  }

  private setDz(dz: DzId): void {
    if (dz === this.setup.dz) return;
    this.setup.dz = dz;
    // Each place comes with the wind it usually gets.
    this.setup.weather = usualWeather(dz, this.setup.weather.sky);
    // A place with a BASE object is there for it; elsewhere there is none.
    const plan = this.setup.jump;
    if (dzInfo(dz).base) plan.start = 'base';
    else if (plan.start === 'base') plan.start = 'plane';
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
    this.changedSetup();
  }

  private setBots(change: Partial<BotsPlan>): void {
    Object.assign(this.setup.bots, change);
    this.changedSetup();
  }

  private setSettings(change: Partial<Settings>): void {
    Object.assign(this.settings, change);
    this.refresh();
    this.onSettings();
  }

  // ------------------------------------------------------------ rows

  /** A setting on its own line: label, value, control, note. */
  private row(
    label: string,
    o: RowOptions & { adjust?: (step: -1 | 1, big: boolean) => void; activate?: () => void },
    ...content: HTMLElement[]
  ): HTMLElement {
    const head = h('div', 'head', h('span', 'label', label));
    if (o.hint) head.append(h('span', 'hint', o.hint));
    const value = h('b', 'value');
    head.append(value);
    const note = h('p', 'note');
    const row = h('div', 'row', head, ...content, note);
    if (o.key) row.dataset.key = o.key;
    this.nav.add(row, { adjust: o.adjust, activate: o.activate, disabled: o.disabled });
    this.updaters.push(() => {
      value.textContent = o.value?.() ?? '';
      note.textContent = o.note?.() ?? '';
      note.hidden = !note.textContent;
    });
    return row;
  }

  /** A row of buttons, one of them lit; left and right move the light. */
  private choice<V>(
    label: string,
    choices: Option<V>[] | (() => Option<V>[]),
    get: () => V,
    set: (value: V) => void,
    o: RowOptions & { cls?: string } = {},
  ): HTMLElement {
    const box = h('div', `choices ${o.cls ?? ''}`);
    let offered: Option<V>[] = [];
    let key = '';
    const offer = (): void => {
      const list = typeof choices === 'function' ? choices() : choices;
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

  /** A slider; left and right step it, more with Shift. `circular`: a heading, with no filled part. */
  private slider(
    label: string,
    range: { min: number; max: number; step: number; big: number; circular?: boolean },
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
    if (range.circular) input.classList.add('circular');
    input.addEventListener('input', () => set(Number(input.value)));
    const control = beside ? h('div', 'beside', beside, input) : input;
    const adjust = (step: -1 | 1, big: boolean): void =>
      set(clamp(get() + step * (big ? range.big : range.step), range.min, range.max));
    const row = this.row(label, { ...o, adjust }, control);
    this.updaters.push(() => {
      const v = get();
      input.value = String(v);
      input.style.setProperty('--fill', `${((v - range.min) / (range.max - range.min)) * 100}%`);
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
    const back = button('back');
    back.innerHTML = `${ICON_BACK}<span>${T.menu.back}</span>`;
    back.addEventListener('click', () => this.show('home'));
    bar.append(this.nav.add(back));
    if (title) bar.append(h('h2', 'title', title));
    else {
      const tabs = h('nav', 'tabs');
      tabs.innerHTML = '<i class="btn pad">LB</i>';
      for (const c of CATEGORIES) {
        const t = button(c.id === id ? 'on' : '');
        t.innerHTML = `${c.icon}<span>${T.menu.categories[c.id]}</span>`;
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
    return hints(T.menu.hints.detail, T.menu.hints.detailPad);
  }

  private buildHome(): HTMLElement {
    const screen = h('section', 'screen screen-home');
    const head = html(`<header class="title-bar">${LOGO}<div><h1>jumpsim</h1><p>${T.menu.tagline}</p></div></header>`);
    const grid = h('div', 'cards');
    for (const c of CATEGORIES) {
      const sum = h('div', 'sum');
      const top = html(
        `<span class="cat-head">${c.icon}<span class="cat">${T.menu.categories[c.id]}</span><span class="more">${T.menu.edit}${ICON_MORE}</span></span>`,
      );
      const card = button(`cat-card cat-${c.id}`, top, sum);
      card.addEventListener('click', () => this.show(c.id));
      this.cards.set(c.id, card);
      grid.append(this.nav.add(card));
      const more = top.querySelector<HTMLElement>('.more')!;
      this.updaters.push(() => {
        sum.innerHTML = this.summary(c.id);
        // In a room, whoever leads sets these.
        const locked = this.isShut(c.id);
        card.classList.toggle('locked', locked);
        more.innerHTML = locked ? `${ICON_LOCK}${T.menu.room.locked}` : `${T.menu.edit}${ICON_MORE}`;
      });
    }
    this.resume.addEventListener('click', () => this.cancel());
    this.jump.addEventListener('click', () => this.go());
    const showJump = (): void => {
      const { start, exitHeight } = this.setup.jump;
      const info = dzInfo(this.setup.dz);
      const room = this.room;
      this.jump.classList.toggle('ready', !!room?.ready);
      if (room?.loadAt) {
        // A public room: aboard the next load, or not.
        const r = T.menu.room;
        this.jump.innerHTML = `<span class="go-icon">${ICON_PLANE}</span><span class="go-label">${
          room.ready ? r.aboard : r.board
        }</span><span class="go-sub">${r.loadSub(timeTo(room.loadAt))}</span><i class="btn pad">Start</i>`;
        return;
      }
      // A public BASE site has no rotation: the button jumps, as alone.
      if (room && !room.publicDz) {
        const r = T.menu.room;
        const count = r.readyCount(room.players.filter((p) => p.ready).length, Math.max(1, room.players.length));
        this.jump.innerHTML = `<span class="go-icon">${ICON_PEOPLE}</span><span class="go-label">${
          room.ready ? r.waiting : r.imReady
        }</span><span class="go-sub">${count}</span><i class="btn pad">Start</i>`;
        return;
      }
      const sub =
        start === 'plane'
          ? `${num(exitHeight)} m · ${info.name}`
          : start === 'base'
            ? `BASE ${num(info.base?.height ?? 0)} m · ${info.name}`
            : start === 'pattern'
              ? T.menu.goPattern(num(info.starts.pattern))
              : T.menu.goFinal(num(info.starts.final));
      const jumping = start === 'plane' || start === 'base';
      this.jump.innerHTML = `<span class="go-icon">${start === 'plane' ? ICON_PLANE : ICON_CANOPY}</span><span class="go-label">${
        jumping ? T.menu.jumpButton : T.menu.go
      }</span><span class="go-sub">${sub}</span><i class="btn pad">Start</i>`;
    };
    this.updaters.push(showJump);
    this.ticking.push(showJump);
    const go = h('div', 'go', this.nav.add(this.resume), this.nav.add(this.jump));
    const m = T.menu.hints;
    screen.append(
      head,
      grid,
      this.buildRoom(),
      go,
      hints(
        `${m.home}<span class="resume-hint">${m.homeResume}</span>`,
        `${m.homePad}<span class="resume-hint">${m.homePadResume}</span>${m.homePadMore}`,
      ),
    );
    return screen;
  }

  /** Jumping with others: make a room, or the one we are in, who is in it and ready. */
  private buildRoom(): HTMLElement {
    const r = T.menu.room;
    const box = h('div', 'room');

    const create = button('room-create');
    create.innerHTML = `${ICON_PEOPLE}<span class="label">${r.create}</span><span class="note">${r.createNote}</span>`;
    create.addEventListener('click', () => this.onCreateRoom());
    const pub = button('room-create room-public');
    const pubLabel = h('span', 'label');
    const pubNote = h('span', 'note');
    pub.append(html(ICON_DZ), pubLabel, pubNote);
    const full = (): boolean => (this.publicCount ?? 0) >= MAX_PEERS;
    pub.addEventListener('click', () => {
      if (!full()) this.onJoinPublic();
    });
    const choices = h('div', 'room-choices', this.nav.add(create), this.nav.add(pub, { disabled: full }));

    const title = h('b', 'room-name');
    const copy = button('room-btn', r.copy);
    let copiedUntil = 0;
    copy.addEventListener('click', () => {
      const link = this.room?.link;
      if (!link) return;
      void navigator.clipboard?.writeText(link).then(() => {
        copiedUntil = performance.now() + 2000;
        this.refresh();
        setTimeout(() => this.refresh(), 2100);
      });
    });
    const rename = button('room-btn', r.rename);
    rename.addEventListener('click', () => this.onRename());
    const leave = button('room-btn', r.leave);
    leave.addEventListener('click', () => this.onLeaveRoom());
    const top = h('div', 'room-top', ICON_PEOPLE_EL(), title, this.nav.add(copy), this.nav.add(rename), this.nav.add(leave));
    const link = h('div', 'room-link');
    const players = h('ul', 'room-players');
    const load = h('p', 'room-load');
    const note = h('p', 'room-note');
    const startNow = button('room-btn room-start', r.startNow);
    const warn = h('p', 'room-warn');
    startNow.addEventListener('click', () => {
      const room = this.room;
      if (!room?.isHost) return;
      const waiting = room.players.filter((p) => !p.ready);
      // Not everyone is ready: a second click, after the warning, goes anyway.
      if (waiting.length > 0 && performance.now() > this.startArmed) {
        this.startArmed = performance.now() + ARM_MS;
        this.refresh();
        setTimeout(() => this.refresh(), ARM_MS + 100);
        return;
      }
      this.startArmed = 0;
      this.onStartNow();
    });
    const inRoom = h('div', 'room-in', top, link, players, load, note, this.nav.add(startNow, { disabled: () => !this.canStartNow() }), warn);
    box.append(choices, inRoom);

    const showLoad = (): void => {
      const room = this.room;
      load.hidden = !room?.loadAt;
      if (room?.loadAt) load.textContent = r.nextLoad(timeTo(room.loadAt), room.players.filter((p) => p.ready).length);
    };
    this.updaters.push(showLoad);
    this.ticking.push(showLoad);

    this.updaters.push(() => {
      const room = this.room;
      choices.hidden = room !== null;
      inRoom.hidden = room === null;
      if (!room) {
        const dz = dzInfo(this.setup.dz).name;
        pubLabel.textContent = r.publicJoin(dz);
        pubNote.textContent = r.publicNote(dz, this.publicCount, MAX_PEERS);
        return;
      }
      title.textContent = room.publicDz ? r.publicName(dzInfo(room.publicDz).name) : r.name(room.room);
      link.textContent = room.link;
      copy.textContent = performance.now() < copiedUntil ? r.copied : r.copy;
      players.replaceChildren(
        ...room.players.map((p) => {
          const li = h('li', p.ready ? 'ready' : '');
          const tags = [p.self ? r.you : '', p.host ? r.host : ''].filter(Boolean).join(' · ');
          li.append(h('i', 'dot'), h('span', '', p.name || '…'));
          if (tags) li.append(h('small', '', tags));
          return li;
        }),
      );
      const host = room.hostName || '…';
      note.textContent = !room.online
        ? r.connecting
        : room.publicDz
          ? room.isHost
            ? r.publicYouSet
            : r.publicHostSets(host)
          : room.isHost
            ? r.youSet
            : r.hostSets(host);
      startNow.hidden = !this.canStartNow();
      const waiting = room.players.filter((p) => !p.ready).map((p) => p.name || '…');
      warn.textContent = performance.now() < this.startArmed && waiting.length > 0 ? r.startNowWarn(waiting.join(', ')) : '';
      warn.hidden = !warn.textContent;
    });
    return box;
  }

  /** Leading a room of more than one where not everyone is ready. */
  private canStartNow(): boolean {
    const room = this.room;
    return !!room?.isHost && !room.publicDz && room.online && room.players.length > 1 && room.players.some((p) => !p.ready);
  }

  /** What a home card says. */
  private summary(c: Category): string {
    const { dz, hour, weather, gear, jump } = this.setup;
    const info = dzInfo(dz);
    switch (c) {
      case 'gear': {
        const rig = rigFor(gear);
        const g = T.menu.gear;
        return `
          <span class="big">${gear.canopyAreaFt2}<small class="unit">ft²</small> <small>${kindName(gear.kind)}</small>${swatch(gear.color)}</span>
          <span>${gear.exitWeightKg} kg · ${num(rig.wingLoading, 2)} lb/ft² · ${loadingLabel(rig.wingLoading)}</span>
          <span class="dim">${gear.suit !== 'jumpsuit' ? `${g.suitLine[gear.suit](gear.suitLevel)} · ` : ''}${g.containerLine[gear.container]} · ${
            g.altimeterLine[gear.altimeter]
          } · ${gear.audible ? g.audibleOn : g.audibleOff} · ${g.sliderLine[gear.slider]}${
            gear.container === 'sport' && gear.rsl ? ' · RSL' : ''
          }${gear.smoke !== 'none' ? ` · ${g.smokeLine(g.smokes[gear.smoke])}` : ''}</span>`;
      }
      case 'dz': {
        return `
          <span class="big">${info.name}${info.icao ? `<small class="chip">${info.icao}</small>` : ''}</span>
          <span>${info.club ?? T.dz.made}</span>
          <span class="dim">${info.note}</span>`;
      }
      case 'weather': {
        const w = T.menu.weather;
        const sky = w.skies[weather.sky];
        const sun = sunPosition(info.lat, info.lon, hour, info.utcOffsetH);
        const gust = gustPeakKmh(weather);
        const wind =
          weather.windKmh === 0
            ? w.calm
            : w.windLine(heading(weather.windFromDeg), compassPoint(weather.windFromDeg), String(weather.windKmh), gust > weather.windKmh ? String(gust) : null);
        const sunLine =
          weather.sky === 'overcast'
            ? w.sunHidden
            : w.sunLine(num(Math.max(0, sun.elevationDeg)), sunOnFinal(sun.azimuthDeg, landingHeading(info, weather.windFromDeg)));
        return `
          <span class="big">${formatHour(hour)} <small>${sky}</small></span>
          <span class="wind">${windArrow(weather.windFromDeg, weather.windKmh === 0)}${wind}</span>
          <span class="dim">${sunLine}</span>`;
      }
      case 'jump': {
        const j = T.menu.jump;
        if (jump.start === 'base') {
          const dz = dzInfo(this.setup.dz).loaded();
          return `
            <span class="big">${num(info.base?.height ?? 0)}<small class="unit">m</small> <small>${j.starts.base}</small></span>
            <span>${info.base?.standing ? j.baseStand : j.baseLine(num(dz?.base?.runUp ?? 25))}</span>
            <span class="dim">${j.baseNote[this.setup.gear.container]}</span>`;
        }
        if (jump.start !== 'plane') {
          const spot = jump.start === 'pattern' ? info.starts.pattern : info.starts.final;
          return `
            <span class="big">${num(spot)}<small class="unit">m</small> <small>${j.starts[jump.start]}</small></span>
            <span>${j.underCanopy[jump.start]}</span>
            <span class="dim">${j.noPlane}</span>`;
        }
        const run = runHeading(this.setup);
        const aloft = Math.round(weather.windKmh * windGradient(jump.exitHeight));
        return `
          <span class="big">${num(jump.exitHeight)}<small class="unit">m</small> <small>${j.starts.plane} · ${j.spots[jump.exitSpot]}</small></span>
          <span>${j.runLine(heading(run), windOnRun(run, weather.windFromDeg, weather.windKmh))}</span>
          <span class="dim">${j.aloftLine(String(aloft), String(Math.round(freefallSeconds(jump.exitHeight))))}</span>`;
      }
    }
  }

  private buildGear(): HTMLElement {
    const { screen, body } = this.screenShell('gear', null);
    const gear = (): Gear => this.setup.gear;
    const g = T.menu.gear;
    body.append(
      this.choice<CanopyKind>(
        g.kind,
        (Object.keys(CANOPY_SIZES) as CanopyKind[]).map((k) => ({ value: k, label: kindName(k) })),
        () => gear().kind,
        (kind) => this.setGear({ kind }),
        { note: () => g.kindNote[gear().kind] },
      ),
      this.choice<number>(
        g.size,
        () => CANOPY_SIZES[gear().kind].map((s) => ({ value: s, label: String(s) })),
        () => gear().canopyAreaFt2,
        (canopyAreaFt2) => this.setGear({ canopyAreaFt2 }),
        { hint: 'ft²', value: () => `${gear().canopyAreaFt2} ft²`, cls: 'sizes' },
      ),
      this.choice<CanopyColorId>(
        g.color,
        (Object.keys(CANOPY_COLORS) as CanopyColorId[]).map((id) => ({ value: id, label: T.setup.colors[id], html: swatch(id) })),
        () => gear().color,
        (color) => this.setGear({ color }),
        { value: () => T.setup.colors[gear().color], cls: 'colors' },
      ),
      this.slider(
        g.weight,
        { min: WEIGHT_MIN, max: WEIGHT_MAX, step: 1, big: 5 },
        () => gear().exitWeightKg,
        (exitWeightKg) => this.setGear({ exitWeightKg }),
        {
          hint: g.weightHint,
          value: () => `${gear().exitWeightKg} kg`,
          note: () => {
            const rig = rigFor(gear());
            const { forward, sink } = trimSpeeds(rig);
            return g.loadingNote(num(rig.wingLoading, 2), loadingLabel(rig.wingLoading), num(forward * 3.6), num(sink, 1), num(forward / sink, 1));
          },
        },
      ),
      this.choice<SuitKind>(g.suit, options(SUIT_KINDS, (k) => g.suits[k]), () => gear().suit, (suit) => this.setGear({ suit }), {
        note: () => {
          const { glide, across, down } = suitGlide(suitOf(gear()), gear().exitWeightKg);
          return g.suitNote[gear().suit](num(glide, 1), num(across), num(down), T.keys.shift);
        },
      }),
      this.choice<SuitLevel>(g.suitLevel, options(SUIT_LEVELS, String), () => gear().suitLevel, (suitLevel) => this.setGear({ suitLevel }), {
        hint: g.suitLevelHint,
        disabled: () => gear().suit === 'jumpsuit',
      }),
      this.choice<OutfitColor>(g.suitColor, outfitChoices, () => gear().suitColor, (suitColor) => this.setGear({ suitColor }), {
        value: () => g.outfitColors[gear().suitColor],
        note: () => (hasWings(suitOf(gear())) ? g.suitColorNote : ''),
        cls: 'outfits',
      }),
      this.choice<OutfitColor>(g.helmet, outfitChoices, () => gear().helmetColor, (helmetColor) => this.setGear({ helmetColor }), {
        value: () => g.outfitColors[gear().helmetColor],
        cls: 'outfits',
      }),
      this.choice<AltimeterKind>(
        g.altimeterRow,
        options(['none', 'analog', 'digital'] as const, (a) => g.altimeter[a]),
        () => gear().altimeter,
        (altimeter) => this.setGear({ altimeter }),
      ),
      this.choice<boolean>(g.audible, yesNo(), () => gear().audible, (audible) => this.setGear({ audible }), { hint: g.audibleHint }),
      this.choice<SliderKind>(g.slider, options(SLIDER_KINDS, (k) => g.sliders[k]), () => gear().slider, (slider) => this.setGear({ slider }), {
        note: () => g.sliderNote[gear().slider](keyLabel('KeyG')),
      }),
      this.choice(g.container, options(CONTAINERS, (c) => g.containers[c]), () => gear().container, (container) => this.setGear({ container }), {
        note: () => g.containerNote[gear().container](String(reserveSize(gear().exitWeightKg))),
      }),
      this.choice<boolean>(g.rsl, yesNo(), () => gear().rsl, (rsl) => this.setGear({ rsl }), {
        hint: g.rslHint,
        note: () => g.rslNote(String(reserveSize(gear().exitWeightKg)), gear().rsl, keyLabel('KeyX')),
        disabled: () => gear().container === 'base',
      }),
      this.choice<SmokeKind>(
        g.smoke,
        SMOKE_KINDS.map((kind) => ({ value: kind, label: g.smokes[kind], ...(kind === 'none' ? {} : { html: smokeDot(kind) }) })),
        () => gear().smoke,
        (smoke) => this.setGear({ smoke }),
        {
          hint: g.smokeHint,
          value: () => g.smokes[gear().smoke],
          note: () => g.smokeNote(gear().smoke !== 'none', String(SMOKE_BURN)),
          cls: 'smokes',
        },
      ),
    );
    screen.append(this.detailHints());
    return screen;
  }

  private buildDz(): HTMLElement {
    const { screen, body } = this.screenShell('dz', null);
    const list = h('div', 'dzs');
    for (const d of DZS) {
      const check = h('i', 'check');
      const thumb = h('img', 'thumb');
      thumb.src = thumbUrl(d.id);
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.addEventListener('error', () => thumb.classList.add('missing'));
      const text = html(
        `<span class="dz-text"><b>${d.name}${d.icao ? `<small class="chip">${d.icao}</small>` : ''}</b><span class="club">${
          d.club ?? T.dz.made
        }</span><span class="note">${d.note}</span></span>`,
      );
      const card = button('dz', h('span', 'thumb-box', thumb), text, check);
      card.dataset.key = `dz-${d.id}`;
      card.addEventListener('click', () => this.setDz(d.id));
      list.append(this.nav.add(card));
      this.updaters.push(() => {
        const on = this.setup.dz === d.id;
        // The real ones come with megabytes of photos: loaded when first chosen.
        const loading = on && !d.loaded();
        card.classList.toggle('on', on);
        card.classList.toggle('loading', loading);
        check.innerHTML = loading ? `<i class="spinner"></i>` : on ? '✓' : '';
      });
    }
    const note = h('p', 'note');
    this.updaters.push(() => {
      const info = dzInfo(this.setup.dz);
      note.textContent = T.menu.dz.usualNote(info.name, heading(info.wind.fromDeg), String(Math.round(info.wind.speed * 3.6)));
    });
    body.append(list, note);
    screen.append(hints(T.menu.hints.dz, T.menu.hints.dzPad));
    return screen;
  }

  private buildWeather(): HTMLElement {
    const { screen, body } = this.screenShell('weather', null);
    const w = (): Weather => this.setup.weather;
    const t = T.menu.weather;
    const compass = new Compass();
    this.updaters.push(() => compass.set(w().windFromDeg, w().windKmh));
    body.append(
      this.slider(t.hour, { min: HOUR_MIN, max: HOUR_MAX, step: 0.25, big: 1 }, () => this.setup.hour, (hour) => this.setHour(hour), {
        hint: t.hourHint,
        value: () => formatHour(this.setup.hour),
        note: () => {
          const info = dzInfo(this.setup.dz);
          const sun = sunPosition(info.lat, info.lon, this.setup.hour, info.utcOffsetH);
          return t.sunNote(
            num(Math.max(0, sun.elevationDeg)),
            sunOnFinal(sun.azimuthDeg, landingHeading(info, w().windFromDeg)),
            w().sky === 'overcast',
          );
        },
      }),
      this.choice<SkyKind>(t.sky, options(['clear', 'cumulus', 'hazy', 'overcast'] as const, (s) => t.skies[s]), () => w().sky, (sky) =>
        this.setWeather({ sky }),
      ),
      this.slider(
        t.windDir,
        { min: 0, max: 355, step: 5, big: 45, circular: true },
        () => w().windFromDeg,
        (windFromDeg) => this.setWeather({ windFromDeg }),
        { value: () => t.windFrom(heading(w().windFromDeg), compassPoint(w().windFromDeg)) },
        compass.el,
      ),
      this.slider(t.windSpeed, { min: 0, max: WIND_MAX_KMH, step: 1, big: 5 }, () => w().windKmh, (windKmh) => this.setWeather({ windKmh }), {
        hint: t.windSpeedHint,
        value: () => (w().windKmh === 0 ? t.calmValue : `${w().windKmh} km/h`),
      }),
      this.choice<GustLevel>(t.gusts, options(['none', 'light', 'strong'] as const, (g) => t.gustLevels[g]), () => w().gusts, (gusts) =>
        this.setWeather({ gusts }), {
        value: () => {
          const gust = gustPeakKmh(w());
          return gust > w().windKmh ? t.gustUpTo(String(gust)) : '';
        },
      }),
      this.action(t.usual, () => this.setWeather(usualWeather(this.setup.dz, w().sky)), {
        note: () => {
          const info = dzInfo(this.setup.dz);
          return t.usualNote(info.name, heading(info.wind.fromDeg), String(Math.round(info.wind.speed * 3.6)));
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
    const noBots = (): boolean => noPlane() || this.room !== null;
    const wings = (): boolean => hasWings(suitOf(this.setup.gear));
    const led = (): boolean => leaderLed(this.setup.bots.mode, suitOf(this.setup.gear));
    const j = T.menu.jump;
    const compass = new Compass();
    this.updaters.push(() => compass.set(this.setup.weather.windFromDeg, this.setup.weather.windKmh, runHeading(this.setup)));
    body.append(
      this.choice<Start>(j.start, () => options(startsAt(this.setup.dz), (s) => j.starts[s]), () => plan().start, (start) => this.setJump({ start }), {
        note: () => {
          const info = dzInfo(this.setup.dz);
          const start = plan().start;
          if (start === 'base') {
            const h = info.base?.height ?? 0;
            // Off a bridge as high as Millau's, a longer delay than off a low one.
            return info.base?.standing ? j.startNote.bridge(num(h), h > 200) : j.startNote.base(num(h));
          }
          if (start === 'pattern') return j.startNote.pattern(num(info.starts.pattern));
          if (start === 'final') return j.startNote.final(num(info.starts.final));
          return j.startNote.plane;
        },
      }),
      this.slider(
        j.exitHeight,
        { min: EXIT_HEIGHT_MIN, max: EXIT_HEIGHT_MAX, step: EXIT_HEIGHT_STEP, big: 500 },
        () => plan().exitHeight,
        (exitHeight) => this.setJump({ exitHeight }),
        {
          hint: j.exitHint,
          value: () => `${num(plan().exitHeight)} m`,
          note: () => {
            const exit = plan().exitHeight;
            if (exit <= 1500) return j.hopPop;
            return j.freefallNote(String(Math.round(freefallSeconds(exit))), num(1000));
          },
          disabled: noPlane,
        },
      ),
      this.choice<ExitSpot>(j.exitSpot, options(EXIT_SPOTS, (s) => j.spots[s]), () => plan().exitSpot, (exitSpot) => this.setJump({ exitSpot }), {
        note: () => `${j.spotNote[plan().exitSpot]} ${j.spotKeys(keyLabel('KeyW'), keyLabel('KeyS'))}`,
        disabled: noPlane,
      }),
      this.slider(j.bots, { min: 0, max: BOTS_MAX, step: 1, big: 1 }, () => this.setup.bots.count, (count) => this.setBots({ count }), {
        hint: j.botsHint,
        value: () => (this.setup.bots.count ? String(this.setup.bots.count) : j.botsNone),
        note: () => (this.room ? j.botsRoom : j.botsNote),
        disabled: noBots,
      }),
      this.choice<BotMode>(j.botMode, options(BOT_MODES, (m) => j.botModes[m]), () => (wings() ? 'track' : this.setup.bots.mode), (mode) => this.setBots({ mode }), {
        note: () => {
          const { pull, breakOff } = botHeights(plan().exitHeight);
          if (wings()) return j.botModeNote.wings(num(breakOff), num(pull));
          return j.botModeNote[this.setup.bots.mode](num(breakOff), num(pull));
        },
        // In wings there is always a leader: nothing to choose.
        disabled: () => noBots() || this.setup.bots.count === 0 || wings(),
      }),
      this.choice<BotLead>(j.botLead, options(BOT_LEADS, (l) => j.botLeads[l]), () => (led() ? 'bot' : this.setup.bots.lead), (lead) => this.setBots({ lead }), {
        note: () => j.botLeadNote[led() ? 'track' : this.setup.bots.lead],
        // A track, and anything in wings, is behind a bot: nothing to choose.
        disabled: () => noBots() || this.setup.bots.count === 0 || led(),
      }),
      this.choice<boolean>(
        j.runAxis,
        [
          { value: true, label: j.intoWind },
          { value: false, label: j.custom },
        ],
        () => plan().runDeg === null,
        (intoWind) => this.setJump({ runDeg: intoWind ? null : this.setup.weather.windFromDeg }),
        { disabled: noPlane },
      ),
      this.slider(
        j.runHeading,
        { min: 0, max: 355, step: 5, big: 45, circular: true },
        () => runHeading(this.setup),
        (runDeg) => this.setJump({ runDeg: validHeading(runDeg) }),
        {
          value: () => `${heading(runHeading(this.setup))} (${compassPoint(runHeading(this.setup))})`,
          note: () => {
            const { weather } = this.setup;
            const aloft = Math.round(weather.windKmh * windGradient(plan().exitHeight));
            const plane = AIRCRAFT[dzInfo(this.setup.dz).aircraft];
            return j.runNote(
              windOnRun(runHeading(this.setup), weather.windFromDeg, weather.windKmh),
              num(plan().exitHeight),
              String(aloft),
              heading(weather.windFromDeg),
              plane.name,
              plane.doorSide < 0,
            );
          },
          disabled: () => noPlane() || plan().runDeg === null,
        },
        compass.el,
      ),
      this.choice<MalfunctionRate>(
        j.malfunction,
        options(MALFUNCTION_RATES, (m) => ({ none: j.never, sometimes: j.oneIn(num(MALFUNCTION_ODDS)), always: j.everyJump })[m]),
        () => plan().malfunction,
        (malfunction) => this.setJump({ malfunction }),
        {
          note: () =>
            plan().malfunction === 'none' ? j.malfunctionOff : plan().start === 'base' ? j.malfunctionBase : j.malfunctionOn(keyLabel('KeyX')),
          disabled: () => noPlane() && plan().start !== 'base',
        },
      ),
    );
    screen.append(this.detailHints());
    return screen;
  }

  private buildSettings(): HTMLElement {
    const s = this.settings;
    const t = T.menu.settingsScreen;
    const { screen, body } = this.screenShell('settings', t.title);
    body.append(
      this.choice<Lang>(t.language, options(LANGS, (l) => ({ fr: 'Français', en: 'English' })[l]), () => lang, (l) => this.setLanguage(l), {
        hint: t.languageHint,
        key: 'language',
      }),
      h('h3', 'section', t.display),
      this.choice<number>(
        t.quality,
        QUALITY_LEVELS.map((_, i) => ({ value: i, label: T.setup.quality[i]! })),
        () => s.quality,
        (quality) => this.setSettings({ quality }),
        { note: () => t.qualityNote },
      ),
      this.choice<boolean>(t.autoResolution, yesNo(), () => s.autoResolution, (autoResolution) => this.setSettings({ autoResolution }), {
        note: () => t.autoResolutionNote,
      }),
      this.choice<boolean>(t.fps, yesNo(), () => s.showFps, (showFps) => this.setSettings({ showFps }), { hint: t.fpsHint }),
      this.choice<boolean>(t.keysOnScreen, yesNo(), () => s.showKeys, (showKeys) => this.setSettings({ showKeys }), {
        hint: t.keysOnScreenHint(keyLabel('KeyK')),
      }),
      h('h3', 'section', t.audio),
      this.choice<boolean>(t.sound, yesNo(), () => s.sound, (sound) => this.setSettings({ sound }), { hint: t.soundHint }),
      this.slider(t.volume, { min: 0, max: 100, step: 5, big: 20 }, () => Math.round(s.volume * 100), (v) => this.setSettings({ volume: v / 100 }), {
        value: () => `${Math.round(s.volume * 100)} %`,
        disabled: () => !s.sound,
      }),
      h('h3', 'section', t.controls),
      this.slider(
        t.sensitivity,
        { min: SENSITIVITY_MIN, max: SENSITIVITY_MAX, step: 0.1, big: 0.5 },
        () => s.mouseSensitivity,
        (v) => this.setSettings({ mouseSensitivity: Math.round(v * 10) / 10 }),
        { value: () => `${num(s.mouseSensitivity, 1)}×` },
      ),
      this.choice<boolean>(t.invertLook, yesNo(), () => s.invertLook, (invertLook) => this.setSettings({ invertLook }), {
        hint: t.invertLookHint,
      }),
      this.choice<boolean>(t.progressiveFly, yesNo(), () => s.progressiveFly, (progressiveFly) => this.setSettings({ progressiveFly }), {
        note: () => t.progressiveFlyNote,
      }),
      this.slider(
        t.progressiveRate,
        { min: PROGRESSIVE_RATE_MIN, max: PROGRESSIVE_RATE_MAX, step: 0.1, big: 0.5 },
        () => s.progressiveRate,
        (v) => this.setSettings({ progressiveRate: Math.round(v * 10) / 10 }),
        { value: () => `${Math.round(s.progressiveRate * 100)} %`, disabled: () => !s.progressiveFly },
      ),
      h('h3', 'section', t.keys),
      this.nav.add(this.controlsTable()),
    );
    screen.append(hints(T.menu.hints.settings, T.menu.hints.settingsPad));
    return screen;
  }

  private controlsTable(): HTMLElement {
    const t = T.menu.settingsScreen;
    const table = h('table', 'controls');
    table.innerHTML = `<thead><tr><th></th><th>${t.keyboard}</th><th>${t.gamepad}</th></tr></thead><tbody>${t
      .controlsTable(keyLabel)
      .map(([what, keys, pad]) => `<tr><td>${what}</td><td>${keys}</td><td>${pad}</td></tr>`)
      .join('')}</tbody>`;
    return h('div', 'row table-row', table);
  }

  private buildLogbook(): HTMLElement {
    const { screen } = this.screenShell('logbook', T.menu.logbookScreen.title);
    screen.querySelector('.body')!.replaceWith(this.logbookBody);
    screen.append(hints(T.menu.hints.logbook, T.menu.hints.logbookPad));
    return screen;
  }

  /** Reads the logbook again and lays it out. */
  private fillLogbook(): void {
    const entries = loadLogbook();
    const stats = logStats(entries);
    const t = T.menu.logbookScreen;
    const body = this.logbookBody;
    body.replaceChildren();
    const time = (s: number): string => {
      const m = Math.floor(s / 60);
      return m >= 60 ? t.hours(Math.floor(m / 60), String(m % 60).padStart(2, '0')) : t.minutes(m, String(Math.round(s % 60)).padStart(2, '0'));
    };
    const tile = (value: string, label: string, sub = ''): string =>
      `<div class="tile"><b>${value}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const upright = stats.groups[0]! + stats.groups[1]!;
    const tiles = h('div', 'tiles');
    tiles.innerHTML = [
      tile(num(stats.jumps), t.jumps(stats.jumps), t.fromPlane(num(stats.planeJumps))),
      tile(time(stats.freefallSeconds), t.freefall),
      tile(time(stats.canopySeconds), t.canopy),
      tile(stats.jumps ? `${Math.round((100 * upright) / stats.jumps)} %` : '—', t.upright),
      tile(stats.bestDistance === null ? '—' : `${num(stats.bestDistance)} m`, t.best, stats.recentDistance === null ? '' : t.recent(num(stats.recentDistance))),
      tile(stats.lowestPull === null ? '—' : `${num(stats.lowestPull)} m`, t.lowest, stats.aadFires ? t.aadFires(stats.aadFires) : ''),
    ].join('');
    body.append(tiles);

    if (stats.jumps) {
      const bar = h('div', 'outcomes');
      bar.innerHTML = `<div class="stack">${stats.groups
        .map((count, i) => (count ? `<i class="o${i}" style="flex:${count}"></i>` : ''))
        .join('')}</div><div class="legend">${OUTCOME_GROUPS.map(
        (g, i) => `<span><i class="o${i}"></i>${T.logbook.groups[g.id]} ${stats.groups[i]}</span>`,
      ).join('')}</div>`;
      body.append(bar);
    }

    body.append(h('h3', 'section', t.list));
    if (!entries.length) body.append(h('p', 'empty', t.empty));
    // Which jumps can be watched again is only known a moment later.
    const tracks = storedTracks();
    for (const e of [...entries].reverse()) {
      const row = this.logRow(e);
      const id = trackId(e.n, e.time);
      row.dataset.track = id;
      const watch = (): void => {
        if (!row.classList.contains('watchable')) return;
        this.watched = id;
        this.onWatch(e);
      };
      // The whole line, its button with it.
      row.addEventListener('click', watch);
      void tracks.then((have) => row.classList.toggle('watchable', have.has(id)));
      body.append(this.nav.add(row, { activate: watch }));
    }

    if (entries.length) {
      const clear = button('action danger', t.clear);
      const act = (): void => {
        if (performance.now() < this.clearArmed) {
          clearLogbook();
          void clearTracks();
          this.clearArmed = 0;
          this.fillLogbook();
          this.nav.setScreen(this.screens.get('logbook')!);
          return;
        }
        this.clearArmed = performance.now() + 4000;
        clear.textContent = t.clearConfirm;
        setTimeout(() => (clear.textContent = T.menu.logbookScreen.clear), 4000);
      };
      clear.tabIndex = -1;
      clear.addEventListener('click', act);
      const row = h('div', 'row action-row', clear);
      body.append(this.nav.add(row, { activate: act }));
    }
  }

  private logRow(e: LogEntry): HTMLElement {
    const t = T.menu.logbookScreen;
    const date = new Date(e.time);
    const when = `${date.toLocaleDateString(T.locale, { day: '2-digit', month: '2-digit' })} ${date.toLocaleTimeString(T.locale, {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
    const start =
      e.start === 'plane' && e.freefall
        ? t.fromPlaneAt(num(e.freefall.exitHeight))
        : e.start === 'base' && e.freefall
          ? t.fromBaseAt(num(e.freefall.exitHeight))
          : T.menu.jump.starts[e.start];
    const canopy = `${e.canopy.areaFt2} ft²${e.canopy.kind === 'triCell' ? ` ${kindName('triCell')}` : ''} · ${e.canopy.exitWeightKg} kg`;
    const ff = e.freefall ? (e.freefall.aad ? t.aad : e.freefall.pullHeight !== null ? t.pulledAt(num(e.freefall.pullHeight)) : '') : '';
    const bad = e.outcome === 'hard' || e.outcome === 'crash' || e.outcome === 'impact';
    const result =
      e.outcome === 'impact'
        ? `${num(e.sink * 3.6)} km/h`
        : `${e.distance === undefined ? '' : t.fromTarget(num(e.distance))}${num(e.sink, 1)} m/s${e.wet ? t.wet : ''}`;
    const row = h('div', 'row entry');
    row.innerHTML = `
      <span class="n">#${e.n}</span>
      <span class="what"><b>${e.dzName}</b> · ${start}${ff}<small>${when} · ${canopy} · ${t.wind(String(e.weather.windKmh))}</small></span>
      <span class="res${bad ? ' bad' : ''}"><b>${T.logbook.outcomes[e.outcome]}</b><small>${result}</small></span>
      <button class="watch" tabindex="-1" title="${t.watch}" aria-label="${t.watch}">${ICON_PLAY}</button>`;
    return row;
  }
}
