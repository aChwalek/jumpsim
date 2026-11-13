// The drop zone from above, beside the menu: the ground as the renderer sees
// it (TopView draws it into `canvas`), and over it what the setup makes of
// it: the target, the pattern flown with this wind, jump run, the wind
// itself. The overlay follows every change at once; the picture is drawn
// again only when the scenery changes (drop zone, photos, hour, sky).

import { T, heading, num } from '../i18n';
import { aircraftOf, runHeading, type Setup } from '../setup';
import { spawnsFor } from '../world/dz';
import { dzInfo, type DzId } from '../world/dzs';
import { PLANE_PATH } from './icons';

/** Half the side of the square shown, m. */
export const MAP_HALF = 800;
/** Overlay units a side: about CSS pixels at the usual size. */
const VIEW = 400;
const K = VIEW / 2 / MAP_HALF;
/** Picture size cap, device pixels. */
const MAX_PICTURE = 1024;

type Point = [number, number];

/**
 * The part of the segment a-b inside the square of half side `half` round
 * the origin, or null if it misses it (Liang-Barsky).
 */
function clip(a: Point, b: Point, half: number): [Point, Point] | null {
  let t0 = 0;
  let t1 = 1;
  const d: Point = [b[0] - a[0], b[1] - a[1]];
  for (const [p, q] of [
    [-d[0], a[0] + half],
    [d[0], half - a[0]],
    [-d[1], a[1] + half],
    [d[1], half - a[1]],
  ] as const) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [
    [a[0] + t0 * d[0], a[1] + t0 * d[1]],
    [a[0] + t1 * d[0], a[1] + t1 * d[1]],
  ];
}

const f = (v: number): string => v.toFixed(1);

/** An arrowhead at `tip` pointing along `angle` (radians, 0 = east, y down). */
function arrowHead(tip: Point, angle: number, size: number, cls: string): string {
  const back = (side: number): Point => [
    tip[0] - size * Math.cos(angle) + side * size * 0.62 * Math.sin(angle),
    tip[1] - size * Math.sin(angle) - side * size * 0.62 * Math.cos(angle),
  ];
  const [l, r] = [back(1), back(-1)];
  return `<path class="${cls}" d="M${f(tip[0])} ${f(tip[1])}L${f(l[0])} ${f(l[1])}L${f(r[0])} ${f(r[1])}Z"/>`;
}

export class DzMap {
  readonly el: HTMLElement;
  /** The ground from above, drawn by the renderer. */
  readonly canvas = document.createElement('canvas');
  /** The drop zone the picture shows. */
  private pictured: DzId | null = null;
  private readonly overlay: SVGSVGElement;
  private readonly name: HTMLElement;
  private readonly code: HTMLElement;
  private readonly club: HTMLElement;
  private readonly wind: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly credit: HTMLElement;
  private readonly veil: HTMLElement;
  private shown = false;
  private dz: DzId | null = null;

  constructor() {
    this.el = document.createElement('section');
    this.el.className = 'map-card';
    this.el.innerHTML = `
      <header class="map-head">
        <div><h2 class="map-name"></h2><p class="map-club"></p></div>
        <span class="map-code"></span>
      </header>
      <div class="map-frame">
        <svg class="map-overlay" viewBox="0 0 ${VIEW} ${VIEW}"></svg>
        <div class="map-wind"></div>
        <div class="map-north"><svg viewBox="-10 -10 20 20"><path d="M0 -9 L8 7 L-8 7 Z"/></svg>N</div>
        <div class="map-scale"><i></i><span></span></div>
        <div class="map-veil"><i class="spinner"></i><span></span></div>
      </div>
      <footer class="map-legend"></footer>
      <p class="map-credit"></p>`;
    const q = <E extends Element = HTMLElement>(s: string): E => this.el.querySelector<E>(s)!;
    q('.map-frame').prepend(this.canvas);
    this.canvas.className = 'map-picture';
    this.overlay = q<SVGSVGElement>('.map-overlay');
    this.name = q('.map-name');
    this.code = q('.map-code');
    this.club = q('.map-club');
    this.wind = q('.map-wind');
    this.legend = q('.map-legend');
    this.credit = q('.map-credit');
    this.veil = q('.map-veil');
    q('.map-scale span').textContent = `${num(500)} m`;
    q<HTMLElement>('.map-scale i').style.width = `${(500 / (2 * MAP_HALF)) * 100}%`;
  }

  /** Whether the menu shows the map at the moment. */
  setShown(shown: boolean): void {
    this.shown = shown;
    this.el.hidden = !shown;
  }

  /** The picture size wanted, device pixels; 0 when the map is not on screen. */
  wantedSize(): number {
    if (!this.shown) return 0;
    const css = this.canvas.clientWidth;
    if (!css) return 0;
    const size = Math.min(MAX_PICTURE, Math.round(css * window.devicePixelRatio));
    if (this.canvas.width !== size) this.canvas.width = this.canvas.height = size;
    return size;
  }

  /** The renderer has just drawn this drop zone into the canvas. */
  pictureDrawn(dz: DzId): void {
    this.pictured = dz;
    this.el.classList.add('pictured');
    this.updateVeil();
  }

  private updateVeil(): void {
    const waiting = this.pictured !== this.dz;
    this.veil.classList.toggle('on', waiting);
    this.veil.querySelector('span')!.textContent = T.menu.loading;
  }

  /** Brings the names and the overlay up to date with the setup. */
  update(setup: Setup): void {
    this.dz = setup.dz;
    const info = dzInfo(setup.dz);
    this.name.textContent = info.name;
    this.code.textContent = info.icao ?? '';
    this.code.hidden = !info.icao;
    this.club.textContent = info.club ?? T.dz.made;
    this.credit.textContent = info.credit ?? '';
    this.updateVeil();

    const { weather, jump } = setup;
    const calm = weather.windKmh === 0;
    this.wind.innerHTML = `<svg viewBox="-12 -12 24 24" style="transform:rotate(${weather.windFromDeg + 180}deg)"><path d="M0 9 V-8 M-5 -3 L0 -9 L5 -3"/></svg><span><b>${
      calm ? T.menu.map.calm : `${weather.windKmh} km/h`
    }</b>${calm ? '' : `<small>${T.menu.map.wind} ${heading(weather.windFromDeg)}</small>`}</span>`;
    this.wind.classList.toggle('calm', calm);

    const t = T.menu.map;
    const swatch = (cls: string, label: string): string => `<span><i class="lg ${cls}"></i>${label}</span>`;
    this.legend.innerHTML = [
      swatch('lg-target', t.target),
      swatch('lg-pattern', t.pattern),
      jump.start === 'plane' ? swatch('lg-run', t.run) : swatch('lg-start', t.start),
    ].join('');

    const pack = info.loaded();
    if (!pack) {
      this.overlay.innerHTML = '';
      return;
    }
    const cx = pack.target.x;
    const cz = pack.target.z;
    const at = (x: number, z: number): Point => [(x - cx) * K + VIEW / 2, (z - cz) * K + VIEW / 2];
    const spots = spawnsFor(pack, weather.windFromDeg, { headingDeg: runHeading(setup), height: jump.exitHeight, aircraft: aircraftOf(setup) });

    // The pattern: downwind from its start, abeam the start of final, base, final into the target.
    const down = (spots.pattern.headingDeg * Math.PI) / 180;
    const d: Point = [Math.sin(down), -Math.cos(down)];
    const p0: Point = [spots.pattern.x, spots.pattern.z];
    const fin: Point = [spots.final.x, spots.final.z];
    const along = (fin[0] - p0[0]) * d[0] + (fin[1] - p0[1]) * d[1];
    const p1: Point = [p0[0] + along * d[0], p0[1] + along * d[1]];
    const [a, b, c, tg] = [at(...p0), at(...p1), at(...fin), at(cx, cz)];
    const angle = (from: Point, to: Point): number => Math.atan2(to[1] - from[1], to[0] - from[0]);
    const mid = (u: Point, v: Point): Point => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];
    const parts: string[] = [];
    parts.push(
      `<path class="pattern" d="M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}L${f(c[0])} ${f(c[1])}"/>`,
      arrowHead(mid(a, b), angle(a, b), 7, 'pattern-head'),
      arrowHead(mid(b, c), angle(b, c), 7, 'pattern-head'),
      `<path class="final" d="M${f(c[0])} ${f(c[1])}L${f(tg[0])} ${f(tg[1])}"/>`,
      arrowHead(mid(c, tg), angle(c, tg), 8, 'final-head'),
    );

    // Jump run, from where the plane starts it, cut to the frame.
    const run = (spots.plane.headingDeg * Math.PI) / 180;
    const ahead: Point = [Math.sin(run), -Math.cos(run)];
    const s0: Point = [(spots.plane.x - cx) * K, (spots.plane.z - cz) * K];
    const s1: Point = [s0[0] + ahead[0] * 3000 * K, s0[1] + ahead[1] * 3000 * K];
    const edge = VIEW / 2 - 6;
    const seen = clip(s0, s1, edge);
    if (seen) {
      const [u, v] = seen.map(([x, y]) => [x + VIEW / 2, y + VIEW / 2] as Point) as [Point, Point];
      const dir = angle(u, v);
      const length = Math.hypot(v[0] - u[0], v[1] - u[1]);
      const off = jump.start === 'plane' ? '' : ' off';
      parts.push(`<g class="run${off}"><path class="run-line" d="M${f(u[0])} ${f(u[1])}L${f(v[0])} ${f(v[1])}"/>`);
      for (const k of [0.35, 0.65]) {
        if (length * (1 - k) > 30) parts.push(arrowHead([u[0] + (v[0] - u[0]) * k, u[1] + (v[1] - u[1]) * k], dir, 8, 'run-head'));
      }
      // The plane where the run comes into view.
      parts.push(
        `<path class="plane" transform="translate(${f(u[0])} ${f(u[1])}) rotate(${f((dir * 180) / Math.PI + 90)}) translate(-11 -11) scale(0.92)" d="${PLANE_PATH}"/></g>`,
      );
    }

    // The target, and where the jump starts if it is already under canopy.
    const r = Math.max(4.5, pack.target.radius * K);
    parts.push(`<circle class="target-glow" cx="${f(tg[0])}" cy="${f(tg[1])}" r="${f(r + 7)}"/>`);
    parts.push(`<circle class="target" cx="${f(tg[0])}" cy="${f(tg[1])}" r="${f(r)}"/>`);
    parts.push(`<circle class="target-dot" cx="${f(tg[0])}" cy="${f(tg[1])}" r="1.8"/>`);
    if (jump.start !== 'plane') {
      const [sx, sy] = jump.start === 'pattern' ? a : c;
      parts.push(`<circle class="start-ring" cx="${f(sx)}" cy="${f(sy)}" r="9"/><circle class="start" cx="${f(sx)}" cy="${f(sy)}" r="4.5"/>`);
    }
    this.overlay.innerHTML = parts.join('');
  }
}
