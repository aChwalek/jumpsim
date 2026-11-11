import type { AltimeterKind } from '../setup';
import type { Controls } from '../sim/flightModel';
import type { LandingRating, Touchdown } from '../sim/landing';
import { Altimeter } from './altimeter';

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
}

export class Hud {
  private readonly root = el('hud');
  private readonly perf = el('perf');
  private readonly wind = el('wind');
  private readonly altimeter = new Altimeter(el('altimeter'));
  private readonly vario = el('varioValue');
  private readonly speed = el('speedValue');
  private readonly brakeL = el('brakeL');
  private readonly brakeR = el('brakeR');
  private readonly frontL = el('frontL');
  private readonly frontR = el('frontR');
  private readonly held = el('held');
  private readonly result = el('result');
  private readonly gear = el('gear');
  private sinceText = 1;

  toggle(): void {
    this.root.classList.toggle('hidden');
  }

  setAltimeter(kind: AltimeterKind, altitude: number): void {
    this.altimeter.setKind(kind);
    this.altimeter.reset(altitude);
  }

  /** What the pilot is flying, shown under the wind. */
  setGear(text: string): void {
    this.gear.textContent = text;
  }

  /** `wet`: the feet came down in a pond. */
  showResult(t: Touchdown | null, distanceToTarget = 0, wet = false): void {
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
      </table>
      <p class="hint">R pour recommencer · 1 circuit · 2 finale · V changer de voile</p>`;
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
