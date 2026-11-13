import { T, num } from '../i18n';
import { keyLabel } from '../input/keyLabels';
import type { AltimeterKind } from '../setup';
import type { Controls } from '../sim/flightModel';
import type { JumpLog } from '../sim/jump';
import type { Malfunction } from '../sim/opening';
import type { TrackMarks } from '../replay/track';
import type { Touchdown } from '../sim/landing';
import { Altimeter } from './altimeter';
import { keysHtml, type InputKind, type KeysPhase, type PadKind } from './keys';

const el = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
};

export interface HudData {
  /** Feet above the drop zone, m: what the altimeter reads. */
  altitude: number;
  /** m/s, negative when descending. */
  verticalSpeed: number;
  /** m/s. */
  groundSpeed: number;
  headingDeg: number;
  controls: Controls;
  held: boolean;
  fps: number;
  renderScale: number;
  windFromDeg: number;
  /** Mean wind and strongest gust at 10 m, km/h. */
  windKmh: number;
  gustKmh: number;
  muted: boolean;
  /** Out of the plane and not yet under canopy: no toggles to show. */
  freefall: boolean;
  /** What to do next, if anything, as HTML. */
  cue: string;
  /** Following a leader: which way our place behind it is, as HTML; empty otherwise. */
  guide: string;
  /** Colour the height: getting low for a pull, or too low. */
  heightAlert: 'none' | 'warn' | 'danger';
}

/** A height in whole metres, with the thousands as the language writes them. */
const metres = (m: number): string => num(Math.round(m));

/** What went wrong with the main, for the card at the end: its name, and what it did. */
const MALFUNCTION_ROWS: Record<Malfunction, () => [string, string]> = {
  streamer: () => [T.hud.streamer, T.hud.streamerRow],
  lineTwists: () => [T.hud.lineTwists, T.hud.lineTwistsRow],
  lineover: () => [T.hud.lineover, T.hud.lineoverRow],
  sliderHang: () => [T.hud.sliderHang, T.hud.sliderHangRow],
  noOpening: () => [T.hud.noOpening, T.hud.noOpeningRow],
  brakeFire: () => [T.hud.brakeFire, T.hud.brakeFireRow],
  offHeading: () => [T.hud.offHeading, T.hud.offHeadingRow],
};

/** What the jump itself was, for the card at the end. */
function jumpRows(log: JumpLog): string {
  const t = T.hud;
  const rows: string[] = [`<tr><td>${log.freefallSeconds.toFixed(0)} s</td><td>${t.freefall((log.topSpeed * 3.6).toFixed(0))}</td></tr>`];
  if (log.pullHeight !== null) {
    const what = log.cutawayHeight === null ? t.pulled(metres(log.openHeight)) : t.pulledOnly;
    rows.push(`<tr><td>${metres(log.pullHeight)} m</td><td>${what}</td></tr>`);
  }
  const malfunction = log.malfunction && MALFUNCTION_ROWS[log.malfunction]();
  if (malfunction) rows.push(`<tr><td>${malfunction[0]}</td><td>${malfunction[1]}</td></tr>`);
  if (log.cutawayHeight !== null) rows.push(`<tr><td>${metres(log.cutawayHeight)} m</td><td>${t.cutawayRow}</td></tr>`);
  if (log.reserveBy !== null && log.reserveHeight !== null) {
    rows.push(`<tr><td>${metres(log.reserveHeight)} m</td><td>${t.reserveRow(log.reserveBy, metres(log.openHeight))}</td></tr>`);
  }
  rows.push(`<tr><td>${num(log.openingLoad, 1)} g</td><td>${t.openingLoad}</td></tr>`);
  return rows.join('');
}

/** What can be done once down: go again, change the jump, or see the end of it again. */
const hint = (): string => `
  <div class="actions">
    <button data-act="retry">${T.hud.retry}</button>
    <button data-act="change">${T.hud.change}</button>
    <button data-act="replay" class="replayBtn">${T.hud.watchAgain}</button>
    <button data-act="watch" class="watchBtn">${T.hud.watchJump}</button>
  </div>
  <p class="hint">${T.hud.again(keyLabel)}</p>`;

export type CardAction = 'retry' | 'change' | 'replay' | 'watch';

/** The replay bar's buttons, and a click on its track: to that moment, s. */
export type WatchCommand = 'toggle' | 'close' | { seek: number };

/** What the replay bar shows of the jump watched again. */
export interface Watched {
  n: number;
  dz: string;
  start: number;
  end: number;
  marks: TrackMarks;
}

/** Minutes and seconds. */
const clock = (s: number): string => {
  const whole = Math.max(0, Math.floor(s));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

export class Hud {
  private readonly root = el('hud');
  private readonly perf = el('perf');
  private readonly wind = el('wind');
  private readonly heightGauge = el('altimeter');
  private readonly altimeter = new Altimeter(this.heightGauge);
  private readonly vario = el('varioValue');
  private readonly speed = el('speedValue');
  private readonly brakeL = el('brakeL');
  private readonly brakeR = el('brakeR');
  private readonly frontL = el('frontL');
  private readonly frontR = el('frontR');
  private readonly held = el('held');
  private readonly result = el('result');
  private readonly gear = el('gear');
  private readonly cue = el('cue');
  private lastCue = '';
  private readonly guide = el('guide');
  private lastGuide = '';
  private readonly keys = el('keys');
  private lastKeys = '';
  private lastKeysArgs = '';
  private sinceText = 1;
  /** Frame rate and render scale in the corner. */
  showFps = true;
  /** A button of the card at the end of the jump. */
  onCard: (action: CardAction) => void = () => {};
  /** A button of the replay bar, or a click on it. */
  onWatch: (command: WatchCommand) => void = () => {};
  private readonly watch = el('watch');
  private watched: Watched | null = null;
  private lastWatched = '';
  /** The card's button chosen with the cross or the arrows, if any. */
  private cardFocus: HTMLElement | null = null;

  constructor() {
    this.result.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act) this.onCard(act as CardAction);
    });
    this.watch.addEventListener('click', (e) => {
      const command = (e.target as HTMLElement).closest<HTMLElement>('[data-watch]')?.dataset.watch;
      if (command === 'toggle' || command === 'close') this.onWatch(command);
    });
    // The track: a click goes to that moment, and dragging along it.
    const seek = (e: PointerEvent) => {
      const w = this.watched;
      const bar = this.watch.querySelector<HTMLElement>('.track');
      if (!w || !bar) return;
      const box = bar.getBoundingClientRect();
      const k = Math.max(0, Math.min(1, (e.clientX - box.left) / Math.max(1, box.width)));
      this.onWatch({ seek: w.start + k * (w.end - w.start) });
    };
    this.watch.addEventListener('pointerdown', (e) => {
      const bar = (e.target as HTMLElement).closest<HTMLElement>('.track');
      if (!bar) return;
      bar.setPointerCapture(e.pointerId);
      seek(e);
    });
    this.watch.addEventListener('pointermove', (e) => {
      const bar = (e.target as HTMLElement).closest<HTMLElement>('.track');
      if (bar?.hasPointerCapture(e.pointerId)) seek(e);
    });
  }

  /**
   * Whether the end of the jump can be seen again in slow motion, and all of
   * it; walking about, the card out of the way.
   */
  setCard(replayable: boolean, walking: boolean, watchable: boolean): void {
    this.result.classList.toggle('noReplay', !replayable);
    this.result.classList.toggle('noWatch', !watchable);
    this.result.classList.toggle('compact', walking);
  }

  /** A whole jump watched again, with its bar on screen; null for none. */
  setWatching(w: Watched | null): void {
    this.watched = w;
    this.lastWatched = '';
    this.root.classList.toggle('watching', w !== null);
    if (!w) return;
    const length = Math.max(1e-3, w.end - w.start);
    const at = (t: number | null, kind: keyof TrackMarks): string =>
      t === null ? '' : `<i class="mark ${kind}" style="left:${((100 * (t - w.start)) / length).toFixed(2)}%" title="${T.hud.marks[kind]}"></i>`;
    this.watch.innerHTML = `
      <div class="head"><b>${T.hud.watchTitle}</b><span class="what">${T.hud.watchWhat(w.n, w.dz)}</span><span class="cam"></span><span class="speed"></span></div>
      <div class="track"><div class="fill"></div>${at(w.marks.exit, 'exit')}${at(w.marks.open, 'open')}${at(w.marks.landing, 'landing')}<div class="knob"></div></div>
      <div class="foot"><span class="time"></span><span class="buttons"><button data-watch="toggle"></button><button data-watch="close" title="${T.hud.watchClose}">✕</button></span></div>`;
  }

  /** Where the replay is, how fast, whether it waits, and whether the camera is let loose. */
  showWatched(time: number, speed: number, paused: boolean, done: boolean, free: boolean): void {
    const w = this.watched;
    if (!w) return;
    const key = `${time.toFixed(1)}|${speed}|${paused}|${done}|${free}`;
    if (key === this.lastWatched) return;
    this.lastWatched = key;
    const k = Math.max(0, Math.min(1, (time - w.start) / Math.max(1e-3, w.end - w.start)));
    const q = <E extends HTMLElement>(s: string) => this.watch.querySelector<E>(s);
    q('.fill')!.style.width = `${(k * 100).toFixed(2)}%`;
    q('.knob')!.style.left = `${(k * 100).toFixed(2)}%`;
    q('.time')!.textContent = `${clock(time - w.start)} / ${clock(w.end - w.start)}`;
    q('.cam')!.textContent = free ? T.hud.freeCamera : '';
    q('.speed')!.textContent = paused ? (done ? T.hud.watchEnd : T.hud.watchPaused) : speed === 1 ? '' : `×${speed}`;
    const toggle = q<HTMLButtonElement>('[data-watch="toggle"]')!;
    toggle.textContent = paused ? '▶' : '❚❚';
    toggle.title = paused ? T.hud.watchPlay : T.hud.watchPause;
  }

  /** Whether the card at the end of the jump is up. */
  get cardShown(): boolean {
    return this.result.style.display === 'block';
  }

  /**
   * The cross or the arrows on the card: the first press picks its first
   * button, the next ones go along them.
   */
  cardMove(step: -1 | 1): void {
    const buttons = [...this.result.querySelectorAll<HTMLElement>('[data-act]')].filter((b) => b.getClientRects().length > 0);
    if (buttons.length === 0) return;
    const at = this.cardFocus ? buttons.indexOf(this.cardFocus) : -1;
    const next = buttons[at < 0 ? 0 : (at + step + buttons.length) % buttons.length]!;
    this.cardFocus?.classList.remove('focus');
    this.cardFocus = next;
    next.classList.add('focus');
  }

  /** A, Space: the button picked on the card, if one is. False when none is. */
  cardActivate(): boolean {
    const b = this.cardFocus;
    if (!b || !this.result.contains(b) || b.getClientRects().length === 0) return false;
    this.onCard(b.dataset.act as CardAction);
    return true;
  }

  toggle(): void {
    this.root.classList.toggle('hidden');
  }

  /** A crash shown again: only the replay's own badge on screen. */
  setReplay(on: boolean): void {
    this.root.classList.toggle('replaying', on);
    if (on) el('replay').innerHTML = `${T.hud.replay}<small>${T.hud.skipReplay}</small>`;
  }

  /** Nothing of the HUD shows behind the menu. */
  setMenuOpen(open: boolean): void {
    this.root.classList.toggle('menu', open);
  }

  /** Writes the fixed labels in the language in use, and the rest on the next update. */
  applyLanguage(): void {
    el('varioLabel').textContent = T.hud.vario;
    el('speedLabel').textContent = T.hud.groundSpeed;
    this.held.textContent = T.hud.held;
    this.lastKeys = '';
    this.lastCue = '';
    this.lastKeysArgs = '';
  }

  /** Shows or hides the keys down the side, whatever the rest does. */
  showKeys(visible: boolean): void {
    this.keys.classList.toggle('off', !visible);
  }

  /** The keys for this moment and this device; null for none (behind the menu). */
  setKeys(phase: KeysPhase | null, input: InputKind, pad: PadKind): void {
    // Built again only when what it shows changes.
    const args = `${phase}|${input}|${pad}`;
    if (args === this.lastKeysArgs) return;
    this.lastKeysArgs = args;
    const html = phase ? keysHtml(phase, input, pad) : '';
    if (html === this.lastKeys) return;
    this.keys.innerHTML = this.lastKeys = html;
    this.keys.classList.toggle('gamepad', input === 'gamepad');
  }

  setAltimeter(kind: AltimeterKind, altitude: number): void {
    this.altimeter.setKind(kind);
    this.altimeter.reset(altitude);
  }

  /** What the pilot is flying, shown under the wind. */
  setGear(text: string): void {
    this.gear.textContent = text;
  }

  /**
   * Hit the ground with no canopy over the head. `opening`: one was coming
   * out; `malfunction`: and had gone wrong.
   */
  showImpact(log: JumpLog, opening: boolean, speed: number, malfunction: Malfunction | null = null): void {
    const t = T.hud;
    const [title, text] =
      opening && malfunction === 'streamer'
        ? [t.streamerTitle, t.streamerText(keyLabel('KeyX'))]
        : opening && malfunction === 'noOpening'
          ? [t.noOpeningTitle, t.noOpeningText(keyLabel('KeyX'))]
          : opening && malfunction === 'sliderHang'
            ? [t.sliderHangTitle, t.sliderHangText(keyLabel('KeyS'), keyLabel('KeyX'))]
            : opening
              ? [t.lowTitle, t.lowText]
              : [t.noPullTitle, log.cutawayHeight !== null ? t.noReserveText : t.noPullText];
    this.cardFocus = null;
    this.result.innerHTML = `
      <h1>${title}</h1>
      <p>${text}</p>
      <table>
        <tr><td>${(speed * 3.6).toFixed(0)} km/h</td><td>${T.hud.atImpact}</td></tr>
        <tr><td>${log.freefallSeconds.toFixed(0)} s</td><td>${T.hud.freefallOnly}</td></tr>
      </table>
      ${hint()}`;
    this.result.style.display = 'block';
  }

  /**
   * Hit the side of a BASE object: in freefall, as the canopy opened, or
   * flying it. `log`: the jump, if it started from the top.
   */
  showStrike(when: 'freefall' | 'opening' | 'canopy', speed: number, log: JumpLog | null): void {
    const t = T.hud;
    const text = { freefall: t.strikeFreefall, opening: t.strikeOpening, canopy: t.strikeCanopy }[when];
    this.cardFocus = null;
    this.result.innerHTML = `
      <h1>${t.strikeTitle}</h1>
      <p>${text}</p>
      <table>
        <tr><td>${(speed * 3.6).toFixed(0)} km/h</td><td>${t.atImpact}</td></tr>
        ${log ? jumpRows(log) : ''}
      </table>
      ${hint()}`;
    this.result.style.display = 'block';
  }

  /** `wet`: the feet came down in a pond. `log`: the jump, if it started from the plane. */
  showResult(t: Touchdown | null, distanceToTarget = 0, wet = false, log: JumpLog | null = null, vines = false): void {
    if (!t) {
      this.result.style.display = 'none';
      return;
    }
    this.cardFocus = null;
    this.result.innerHTML = `
      <h1>${T.hud.titles[t.rating]}</h1>
      <p>${T.hud.comments[t.rating]}${wet ? T.hud.wet : ''}${vines ? T.hud.vines : ''}</p>
      <table>
        <tr><td>${num(t.sink, 1)} m/s</td><td>${T.hud.sink}</td></tr>
        <tr><td>${(t.groundSpeed * 3.6).toFixed(0)} km/h</td><td>${T.hud.groundSpeedRow}</td></tr>
        <tr><td>${metres(distanceToTarget)} m</td><td>${T.hud.fromTarget}</td></tr>
        ${log ? jumpRows(log) : ''}
      </table>
      ${hint()}`;
    this.result.style.display = 'block';
  }

  update(d: HudData, frameSeconds: number): void {
    // Bars follow every frame; numbers change at a readable rate.
    this.brakeL.style.height = `${Math.min(d.controls.brakeL, 1) * 100}%`;
    this.brakeR.style.height = `${Math.min(d.controls.brakeR, 1) * 100}%`;
    // Wraps: the bar stays full and turns red.
    this.brakeL.classList.toggle('wraps', d.controls.brakeL > 1);
    this.brakeR.classList.toggle('wraps', d.controls.brakeR > 1);
    this.frontL.style.opacity = String(d.controls.frontL);
    this.frontR.style.opacity = String(d.controls.frontR);
    this.held.style.opacity = d.held ? '0.9' : '0';
    this.altimeter.update(d.altitude, frameSeconds);
    this.root.classList.toggle('freefall', d.freefall);
    this.heightGauge.classList.toggle('warn', d.heightAlert === 'warn');
    this.heightGauge.classList.toggle('danger', d.heightAlert === 'danger');
    if (d.cue !== this.lastCue) {
      this.cue.innerHTML = this.lastCue = d.cue;
    }
    if (d.guide !== this.lastGuide) {
      this.guide.innerHTML = this.lastGuide = d.guide;
    }

    this.sinceText += frameSeconds;
    if (this.sinceText < 0.1) return;
    this.sinceText = 0;
    this.vario.textContent = d.verticalSpeed.toFixed(1);
    this.speed.textContent = (d.groundSpeed * 3.6).toFixed(0);
    const fps = this.showFps ? T.hud.fps(d.fps.toFixed(0), (d.renderScale * 100).toFixed(0)) : '';
    this.perf.textContent = [fps, d.muted ? T.hud.muted : ''].filter(Boolean).join(' · ');
    const pad3 = (deg: number): string => `${deg.toFixed(0).padStart(3, '0')}°`;
    this.wind.textContent = T.hud.wind(
      pad3(d.headingDeg),
      pad3(d.windFromDeg),
      d.windKmh.toFixed(0),
      d.gustKmh > d.windKmh ? String(d.gustKmh) : null,
    );
  }
}
