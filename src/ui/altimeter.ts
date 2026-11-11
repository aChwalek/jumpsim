// The altimeter on the wrist, drawn in the lower left corner: a dial with a
// needle, or digits, or nothing at all. Like the real ones it reads the
// altitude above the drop zone it was zeroed on, not the height above
// whatever is underneath.

import type { AltimeterKind } from '../setup';

const SVG = 'http://www.w3.org/2000/svg';
/** One turn of the needle, m: the usual metric skydiving dial. */
const DIAL_FULL_SCALE = 4000;
/** Digital ones refresh a few times a second. */
const DIGITAL_REFRESH = 0.25;
/** Barometric readings lag a little behind the real altitude, s. */
const LAG = 0.4;

const node = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

function arc(r: number, fromM: number, toM: number): string {
  const angle = (m: number): number => (m / DIAL_FULL_SCALE) * Math.PI * 2;
  const point = (m: number): string => `${(r * Math.sin(angle(m))).toFixed(2)} ${(-r * Math.cos(angle(m))).toFixed(2)}`;
  const large = toM - fromM > DIAL_FULL_SCALE / 2 ? 1 : 0;
  return `M ${point(fromM)} A ${r} ${r} 0 ${large} 1 ${point(toM)}`;
}

/** A metric freefall altimeter face: 0 to 4000 m in one turn, hundreds of metres marked. */
function buildDial(): { svg: SVGSVGElement; needle: SVGGElement } {
  const svg = node('svg', { viewBox: '-60 -60 120 120', class: 'dial' });
  svg.append(node('circle', { r: 58, fill: '#2a2d33' }), node('circle', { r: 54, fill: '#0d0f12' }));
  // Red below 1000 m, yellow to 1500 m: the freefall decision heights.
  svg.append(
    node('path', { d: arc(47, 0, 1000), stroke: '#d8322a', 'stroke-width': 7, fill: 'none' }),
    node('path', { d: arc(47, 1000, 1500), stroke: '#e8b818', 'stroke-width': 7, fill: 'none' }),
  );
  for (let m = 0; m < DIAL_FULL_SCALE; m += 100) {
    const big = m % 500 === 0;
    const a = (m / DIAL_FULL_SCALE) * Math.PI * 2;
    const r0 = big ? 40 : 44;
    svg.append(
      node('line', {
        x1: r0 * Math.sin(a),
        y1: -r0 * Math.cos(a),
        x2: 51 * Math.sin(a),
        y2: -51 * Math.cos(a),
        stroke: '#f2f2f2',
        'stroke-width': big ? 2.2 : 1.1,
      }),
    );
    if (m % 500 === 0) {
      const label = node('text', {
        x: 31 * Math.sin(a),
        y: -31 * Math.cos(a) + 4,
        fill: '#f2f2f2',
        'font-size': 11,
        'font-weight': 650,
        'text-anchor': 'middle',
      });
      label.textContent = String(m / 100);
      svg.append(label);
    }
  }
  const unit = node('text', { x: 0, y: 16, fill: '#9aa0a8', 'font-size': 6.5, 'text-anchor': 'middle' });
  unit.textContent = '×100 m';
  svg.append(unit);
  const needle = node('g', {});
  needle.append(
    node('path', { d: 'M -2.6 8 L 0 -50 L 2.6 8 Z', fill: '#f4f4f4' }),
    node('circle', { r: 4.5, fill: '#f4f4f4' }),
    node('circle', { r: 1.6, fill: '#0d0f12' }),
  );
  svg.append(needle);
  return { svg, needle };
}

export class Altimeter {
  private kind: AltimeterKind = 'none';
  private readonly dial: SVGSVGElement;
  private readonly needle: SVGGElement;
  private readonly digital: HTMLElement;
  private readonly digits: HTMLElement;
  private reading = 0;
  private sinceDigits = DIGITAL_REFRESH;

  constructor(private readonly root: HTMLElement) {
    const { svg, needle } = buildDial();
    this.dial = svg;
    this.needle = needle;
    this.digital = document.createElement('div');
    this.digital.className = 'digital';
    this.digits = document.createElement('span');
    this.digits.className = 'digits';
    const unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = 'm';
    this.digital.append(this.digits, unit);
    root.append(this.dial, this.digital);
    this.setKind('none');
  }

  setKind(kind: AltimeterKind): void {
    this.kind = kind;
    this.root.style.display = kind === 'none' ? 'none' : '';
    this.dial.style.display = kind === 'analog' ? '' : 'none';
    this.digital.style.display = kind === 'digital' ? '' : 'none';
  }

  /** Jumps straight to an altitude, as after a new start. */
  reset(altitude: number): void {
    this.reading = altitude;
    this.sinceDigits = DIGITAL_REFRESH;
  }

  /** `altitude` above the drop zone, m. */
  update(altitude: number, frameSeconds: number): void {
    this.reading += (altitude - this.reading) * Math.min(1, frameSeconds / LAG);
    if (this.kind === 'analog') {
      // Stops at zero: below the field it was set on, a needle has nowhere to go.
      const turn = (Math.max(0, this.reading) / DIAL_FULL_SCALE) * 360;
      this.needle.setAttribute('transform', `rotate(${turn.toFixed(2)})`);
    } else if (this.kind === 'digital') {
      this.sinceDigits += frameSeconds;
      if (this.sinceDigits < DIGITAL_REFRESH) return;
      this.sinceDigits = 0;
      // Whole metres: the pressure sensor is no better than that.
      const shown = Math.round(this.reading);
      this.digits.textContent = String(Object.is(shown, -0) ? 0 : shown);
    }
  }
}
