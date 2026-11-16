import { T, num } from '../i18n';
import type { PersonalRecord, RecordKind } from '../records';
import './records.css';

const label = (kind: RecordKind): string => {
  const t = T.menu.logbookScreen;
  return ({ lowestPull: t.lowest, bestDistance: t.best, bestScore: t.bestScore,
    longestFlightSeconds: t.longestFlight, longestFlightDistance: t.longestDistance, longestFreefallSeconds: t.longestFreefall,
    fastestVerticalSpeed: t.fastestVertical, fastestHorizontalSpeed: t.fastestHorizontal,
    longestSwoopDistance: t.longestSwoop, longestSwoopSeconds: t.longestSwoopTime, fastestSwoopSpeed: t.fastestSwoop,
    longestSlide: t.longestSlide,
    bestStreak: t.bestStreak })[kind];
};

export function recordValue(kind: RecordKind, value: number): string {
  if (kind === 'bestStreak') return num(Math.round(value));
  if (kind === 'bestScore') return `${num(Math.round(value))} pts`;
  if (kind.includes('Speed')) return `${num(value * 3.6, 1)} km/h`;
  if (kind.includes('Seconds')) return `${num(value, 2)} s`;
  if (kind === 'longestSwoopDistance' && value < 1) return `${num(value * 100, 1)} cm`;
  return `${num(value, 2)} m`;
}

function scope(record: PersonalRecord): string {
  return [record.global ? T.hud.records.global : '', record.discipline ? T.menu.logbookScreen.disciplines[record.discipline] : ''].filter(Boolean).join(' · ');
}

/** One changing card keeps long award sequences from pushing the actions away. */
export class RecordCelebration {
  private frame = 0;
  private host: HTMLElement | null = null;
  private records: readonly PersonalRecord[] = [];

  clear(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.host?.remove();
    this.host = null;
    this.records = [];
  }

  finish(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const host = this.host;
    if (!host) return;
    host.replaceChildren();
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = T.hud.records.summary(this.records.length);
    const list = document.createElement('ul');
    for (const record of this.records) {
      const item = document.createElement('li');
      item.textContent = `${label(record.kind)} : ${recordValue(record.kind, record.value)} · ${scope(record)}`;
      list.append(item);
    }
    details.append(summary, list);
    host.append(details);
  }

  start(card: HTMLElement, records: readonly PersonalRecord[], sound: (kind: 'tick' | 'stamp') => void): void {
    this.clear();
    if (!records.length) return;
    this.records = records;
    const host = document.createElement('section');
    host.className = 'record-celebration';
    this.host = host;
    card.querySelector('.actions')!.before(host);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return this.finish();
    let index = 0;
    const next = (): void => {
      const record = records[index];
      if (!record) return this.finish();
      host.innerHTML = `<div class="record-award"><span class="record-kicker"></span><span class="record-label"></span><b class="record-number"></b><span class="record-scope"></span><span class="record-previous"></span><span class="record-stamp" aria-hidden="true">✓</span></div><div class="record-footer"><span></span><button type="button" data-record-skip></button></div><span class="record-announcement" role="status"></span>`;
      const q = (selector: string): HTMLElement => host.querySelector<HTMLElement>(selector)!;
      const award = q('.record-award');
      q('.record-kicker').textContent = record.previous === null ? T.hud.records.first : T.hud.records.new;
      q('.record-label').textContent = label(record.kind);
      q('.record-scope').textContent = scope(record);
      q('.record-previous').textContent = record.previous === null ? '' : T.hud.records.previous(recordValue(record.kind, record.previous));
      q('.record-footer span').textContent = `${index + 1} / ${records.length}`;
      const skip = q('[data-record-skip]');
      skip.textContent = T.hud.records.skip;
      skip.onclick = () => this.finish();
      const number = q('.record-number');
      number.setAttribute('aria-hidden', 'true');
      let elapsed = 0;
      let last = performance.now();
      let lastTick = 0;
      let stamped = false;
      const tick = (now: number): void => {
        elapsed += Math.min(50, now - last);
        last = now;
        const progress = Math.min(1, elapsed / 850);
        const from = record.previous ?? 0;
        number.textContent = recordValue(record.kind, from + (record.value - from) * (1 - (1 - progress) ** 3));
        if (progress < 1 && elapsed - lastTick >= 75) {
          lastTick = elapsed;
          sound('tick');
        }
        if (progress === 1 && !stamped) {
          stamped = true;
          award.classList.add('stamped');
          q('.record-announcement').textContent = `${label(record.kind)} : ${recordValue(record.kind, record.value)} · ${scope(record)}`;
          sound('stamp');
        }
        if (elapsed >= 1550) {
          index++;
          next();
        } else this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    };
    next();
  }
}
