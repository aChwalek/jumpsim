// `?bench`: what each part of the picture costs on this device. The jump is
// frozen in place; each part of the scene is hidden in turn, then the picture
// drawn at half its pixels, and the frame rate of each step is reported
// (see perf.ts). A part whose hiding gives back a lot is what to lighten.

import type * as THREE from 'three';
import type { PerfMeter, PerfScene, PerfSummary } from './perf';

/** Seconds let go by after a change, before measuring: shaders compile, the frame rate settles. */
const SETTLE = 1.5;
/** Seconds measured per step. */
const MEASURE = 4;

/** Something the bench can take away, and put back. */
export interface BenchStep {
  label: string;
  apply(): void;
  undo(): void;
}

/** Hides an object for a step. */
export function hiding(label: string, object: THREE.Object3D): BenchStep {
  let was = true;
  return {
    label,
    apply: () => {
      was = object.visible;
      object.visible = false;
    },
    undo: () => (object.visible = was),
  };
}

const wait = (seconds: number): Promise<void> => new Promise((r) => setTimeout(r, seconds * 1000));

export async function runBench(meter: PerfMeter, steps: BenchStep[], scene: () => PerfScene): Promise<void> {
  const banner = document.createElement('div');
  banner.style.cssText =
    'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:99;padding:6px 12px;border-radius:8px;' +
    'background:rgba(0,0,0,.6);color:#fff;font:600 13px/1.3 -apple-system,sans-serif;pointer-events:none;white-space:nowrap';
  document.body.append(banner);
  const all = [{ label: 'all', apply: () => {}, undo: () => {} }, ...steps];
  const results: { label: string; summary: PerfSummary }[] = [];
  for (const [i, step] of all.entries()) {
    banner.textContent = `bench ${i + 1}/${all.length} · ${step.label}`;
    step.apply();
    await wait(SETTLE);
    results.push({ label: step.label, summary: await meter.measure(step.label, MEASURE, scene()) });
    step.undo();
  }
  const base = results[0]!.summary.fps;
  console.table(results.map((r) => ({ step: r.label, fps: r.summary.fps.toFixed(1), cpuMs: r.summary.cpuMs.toFixed(1), gain: (r.summary.fps - base).toFixed(1) })));
  banner.textContent = `bench ✓ · ${base.toFixed(0)} fps`;
  await wait(4);
  banner.remove();
}
