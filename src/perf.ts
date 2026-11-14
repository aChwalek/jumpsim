// How the picture runs, measured in the browser and sent to the Worker
// (POST /perf, see net/perfSchema.ts): every few seconds of play, and for each
// step of a bench. Anonymous: a random id for the visit, nothing else about who plays.

import type * as THREE from 'three';
import type { PerfReport } from './net/perfSchema';

declare const __BUILD__: string;

/** Seconds of play summed up in one report. */
const WINDOW = 10;
/** Shorter than this, a window cut short by a change of phase is not worth sending. */
const MIN_WINDOW = 3;
/** A frame longer than this is a visible hitch, ms. */
const HITCH = 50;
/** Longer than this the tab was hidden or the page stalled: not a frame, s. */
const GAP = 1;

/** What the frame was drawing: changes cut the window short. */
export interface PerfScene {
  phase: string;
  dz: string;
  sky: string;
  view: string;
}

/** What the device and the picture are like, read when a report goes. */
export interface PerfDisplay {
  pixelRatio: number;
  bufferWidth: number;
  bufferHeight: number;
  renderScale: number;
  quality: number;
}

/** One window's summary, as a bench step reads it back. */
export interface PerfSummary {
  fps: number;
  frameMs: number;
  p95Ms: number;
  cpuMs: number;
}

const session = Math.random().toString(36).slice(2, 10);

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

/** The graphics chip, as WebGL names it (unmasked where the browser allows). */
function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch {
    return '';
  }
}

function displayMode(): string {
  if (typeof matchMedia !== 'function') return 'browser';
  if (matchMedia('(display-mode: fullscreen)').matches) return 'fullscreen';
  if (matchMedia('(display-mode: standalone)').matches) return 'standalone';
  return 'browser';
}

export class PerfMeter {
  /** Off, nothing is measured or sent (local development). */
  readonly enabled: boolean;
  private readonly gpu: string;
  private frames: number[] = [];
  private cpu = 0;
  private render = 0;
  private calls = 0;
  private triangles = 0;
  private seconds = 0;
  private scene: PerfScene | null = null;
  private frameStart = 0;
  private renderStart = 0;
  /** A bench step being measured: its label, length, and who waits for it. */
  private step: { label: string; seconds: number; done: (s: PerfSummary) => void } | null = null;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly display: () => PerfDisplay,
    private readonly handheld: boolean,
  ) {
    this.enabled = !import.meta.env.DEV;
    this.gpu = gpuName(renderer.getContext());
    // The counts of every render call in the frame, not just the last one's.
    renderer.info.autoReset = false;
    // Leaving: what is measured so far goes too.
    addEventListener('pagehide', () => this.flush(true));
  }

  /** At the very start of the frame. */
  begin(): void {
    this.frameStart = performance.now();
    this.renderer.info.reset();
  }

  /** Just before the frame's render calls. */
  beforeRender(): void {
    this.renderStart = performance.now();
  }

  /**
   * Just after the frame's render calls, with the time since the last frame, s,
   * and what was drawn. Sends a report when the window is full or the scene changed.
   */
  afterRender(elapsed: number, scene: PerfScene): void {
    const end = performance.now();
    if (elapsed > GAP) return;
    if (!this.step && this.scene && !sameScene(this.scene, scene)) this.flush(false);
    if (!this.step) this.scene = scene;
    this.frames.push(elapsed * 1000);
    this.cpu += end - this.frameStart;
    this.render += end - this.renderStart;
    this.calls += this.renderer.info.render.calls;
    this.triangles += this.renderer.info.render.triangles;
    this.seconds += elapsed;
    if (this.step) {
      if (this.seconds >= this.step.seconds) {
        const { label, done } = this.step;
        this.step = null;
        done(this.send(label));
      }
    } else if (this.seconds >= WINDOW) this.flush(false);
  }

  /**
   * Starts afresh and measures the next `seconds` as a bench step called
   * `label`: reported, and summed up for the caller.
   */
  measure(label: string, seconds: number, scene: PerfScene): Promise<PerfSummary> {
    this.reset();
    this.scene = scene;
    return new Promise((done) => (this.step = { label, seconds, done }));
  }

  /** Forgets what is measured so far, unsent: after a change that would spoil it. */
  reset(): void {
    this.frames = [];
    this.cpu = this.render = this.calls = this.triangles = this.seconds = 0;
  }

  private flush(leaving: boolean): void {
    if (this.step) return;
    if (this.seconds >= MIN_WINDOW) this.send('', leaving);
    this.reset();
  }

  /** Sends what is measured, and starts afresh. */
  private send(bench: string, leaving = false): PerfSummary {
    const n = this.frames.length || 1;
    const sorted = [...this.frames].sort((a, b) => a - b);
    const summary: PerfSummary = {
      fps: this.frames.length / Math.max(this.seconds, 1e-3),
      frameMs: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      cpuMs: this.cpu / n,
    };
    const scene = this.scene ?? { phase: '', dz: '', sky: '', view: '' };
    const d = this.display();
    const nav = navigator as Navigator & { deviceMemory?: number };
    const report: PerfReport = {
      session,
      build: typeof __BUILD__ === 'string' ? __BUILD__ : '',
      phase: bench ? 'bench' : scene.phase,
      dz: scene.dz,
      sky: scene.sky,
      view: scene.view,
      bench,
      gpu: this.gpu,
      userAgent: navigator.userAgent,
      device: this.handheld ? 'handheld' : 'desktop',
      display: displayMode(),
      ...summary,
      worstMs: sorted[sorted.length - 1] ?? 0,
      hitches: this.frames.filter((f) => f > HITCH).length,
      renderMs: this.render / n,
      calls: this.calls / n,
      triangles: this.triangles / n,
      pixelRatio: d.pixelRatio,
      bufferWidth: d.bufferWidth,
      bufferHeight: d.bufferHeight,
      dpr: window.devicePixelRatio,
      renderScale: d.renderScale,
      quality: d.quality,
      seconds: this.seconds,
      cores: navigator.hardwareConcurrency ?? 0,
      memory: nav.deviceMemory ?? 0,
    };
    this.reset();
    if (this.enabled) post(report, leaving);
    return summary;
  }
}

const sameScene = (a: PerfScene, b: PerfScene): boolean => a.phase === b.phase && a.dz === b.dz && a.sky === b.sky && a.view === b.view;

function post(report: PerfReport, leaving: boolean): void {
  const body = JSON.stringify(report);
  try {
    // Leaving, only a beacon is sure to go.
    if (leaving && navigator.sendBeacon) navigator.sendBeacon('/perf', new Blob([body], { type: 'application/json' }));
    else void fetch('/perf', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  } catch {
    // Measuring must never get in the way.
  }
}
