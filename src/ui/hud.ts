import type { AltimeterKind } from '../setup';
import type { Controls } from '../sim/flightModel';
import type { JumpLog } from '../sim/jump';
import type { LandingRating, Touchdown } from '../sim/landing';
import { Altimeter } from './altimeter';
import { keysHtml, type InputKind, type KeysPhase } from './keys';

const TITLES: Record<LandingRating, string> = {
  standUp: 'Posé debout',
  firm: 'Posé debout',
  heavy: 'Posé debout',
  run: 'Posé couru',
  slide: 'Posé glissé',
  hard: 'Atterrissage dur',
  crash: 'Crash',
};

const COMMENTS: Record<LandingRating, string> = {
  standUp: 'Propre.',
  firm: 'Un peu sec à l\'arrivée, mais ça tient debout.',
  heavy: 'Arrivée sèche : ça tasse les jambes, mais ça tient debout.',
  run: 'Quelques pas de course, rien de grave.',
  slide: 'Trop de vitesse sol pour courir : ça finit en glissade.',
  hard: 'Ça fait mal. Arrondi trop haut, trop bas, ou en virage ?',
  crash: 'Blessure probable.',
};

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
  /** Colour the height: getting low for a pull, or too low. */
  heightAlert: 'none' | 'warn' | 'danger';
}

/** A height in metres with a thin space in the thousands, as French altimeters print. */
const metres = (m: number): string => Math.round(m).toLocaleString('fr-FR');

/** What the jump itself was, for the card at the end. */
function jumpRows(log: JumpLog): string {
  const pull = log.aad
    ? `<tr><td>${metres(log.openHeight)} m</td><td>ouvert par le déclencheur de sécurité</td></tr>`
    : `<tr><td>${metres(log.pullHeight ?? 0)} m</td><td>hauteur d'ouverture, voile en vol à ${metres(log.openHeight)} m</td></tr>`;
  return `
    <tr><td>${log.freefallSeconds.toFixed(0)} s</td><td>de chute libre, jusqu'à ${(log.topSpeed * 3.6).toFixed(0)} km/h</td></tr>
    ${pull}
    <tr><td>${log.openingLoad.toFixed(1)} g</td><td>à l'ouverture</td></tr>`;
}

const HINT = '<p class="hint">R pour recommencer · 1 circuit · 2 finale · 3 avion · V changer de voile</p>';

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
  private readonly keys = el('keys');
  private lastKeys = '';
  private sinceText = 1;

  toggle(): void {
    this.root.classList.toggle('hidden');
  }

  /** Shows or hides the keys down the side, whatever the rest does. */
  showKeys(visible: boolean): void {
    this.keys.classList.toggle('off', !visible);
  }

  /** The keys for this moment and this device; null for none (behind the menu). */
  setKeys(phase: KeysPhase | null, input: InputKind): void {
    const html = phase ? keysHtml(phase, input) : '';
    if (html === this.lastKeys) return;
    this.keys.innerHTML = this.lastKeys = html;
  }

  setAltimeter(kind: AltimeterKind, altitude: number): void {
    this.altimeter.setKind(kind);
    this.altimeter.reset(altitude);
  }

  /** What the pilot is flying, shown under the wind. */
  setGear(text: string): void {
    this.gear.textContent = text;
  }

  /** Hit the ground with no canopy over the head. `opening`: one was coming out. */
  showImpact(log: JumpLog, opening: boolean, speed: number): void {
    this.result.innerHTML = `
      <h1>${opening ? 'Ouverture trop basse' : 'Pas d\'ouverture'}</h1>
      <p>${opening ? 'La voile n\'a pas eu le temps de s\'ouvrir.' : 'Impact en chute libre.'}</p>
      <table>
        <tr><td>${(speed * 3.6).toFixed(0)} km/h</td><td>à l'impact</td></tr>
        <tr><td>${log.freefallSeconds.toFixed(0)} s</td><td>de chute libre</td></tr>
      </table>
      ${HINT}`;
    this.result.style.display = 'block';
  }

  /** `wet`: the feet came down in a pond. `log`: the jump, if it started from the plane. */
  showResult(t: Touchdown | null, distanceToTarget = 0, wet = false, log: JumpLog | null = null): void {
    if (!t) {
      this.result.style.display = 'none';
      return;
    }
    this.result.innerHTML = `
      <h1>${TITLES[t.rating]}</h1>
      <p>${COMMENTS[t.rating]}${wet ? ' Et plouf : dans le pond.' : ''}</p>
      <table>
        <tr><td>${t.sink.toFixed(1)} m/s</td><td>vitesse verticale</td></tr>
        <tr><td>${(t.groundSpeed * 3.6).toFixed(0)} km/h</td><td>vitesse sol</td></tr>
        <tr><td>${distanceToTarget.toFixed(0)} m</td><td>de la cible</td></tr>
        ${log ? jumpRows(log) : ''}
      </table>
      ${HINT}`;
    this.result.style.display = 'block';
  }

  update(d: HudData, frameSeconds: number): void {
    // Bars follow every frame; numbers change at a readable rate.
    this.brakeL.style.height = `${d.controls.brakeL * 100}%`;
    this.brakeR.style.height = `${d.controls.brakeR * 100}%`;
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

    this.sinceText += frameSeconds;
    if (this.sinceText < 0.1) return;
    this.sinceText = 0;
    this.vario.textContent = d.verticalSpeed.toFixed(1);
    this.speed.textContent = (d.groundSpeed * 3.6).toFixed(0);
    this.perf.textContent = `${d.fps.toFixed(0)} i/s · rendu ${(d.renderScale * 100).toFixed(0)} %${d.muted ? ' · son coupé' : ''}`;
    const gusts = d.gustKmh > d.windKmh ? `, rafales ${d.gustKmh}` : '';
    this.wind.textContent = `cap ${d.headingDeg.toFixed(0).padStart(3, '0')}° · vent du ${d.windFromDeg
      .toFixed(0)
      .padStart(3, '0')}° ${d.windKmh.toFixed(0)} km/h${gusts}`;
  }
}
