/**
 * What a browser reports of how the picture runs, every few seconds of play
 * and for each step of a bench (`?bench`). Anonymous: a random id per visit,
 * nothing about who plays. Shared with the Worker, which writes it to
 * Workers Analytics Engine, so no DOM types here.
 *
 * Analytics Engine stores strings as blob1..blob20 and numbers as
 * double1..double20, in the order below: query them by those names, e.g.
 *   SELECT blob2 AS phase, avg(double1) AS fps FROM jumpsim_perf GROUP BY phase
 * Only ever add at the end, or older rows read wrong.
 */

/** Strings, blob1 onwards. */
export const PERF_BLOBS = [
  /** The build the browser runs (commit or build date). */
  'build',
  /** menu, plane, standing, freefall, opening, canopy, ground, replay, watch, paused, or bench. */
  'phase',
  /** Drop zone id. */
  'dz',
  /** The sky chosen: how much cloud. */
  'sky',
  /** eyes or outside. */
  'view',
  /** In a bench: what was hidden or changed for this step ('' otherwise). */
  'bench',
  /** The graphics chip, as WebGL names it. */
  'gpu',
  'userAgent',
  /** handheld or desktop. */
  'device',
  /** browser, standalone or fullscreen: installed on the home screen or not. */
  'display',
  /**
   * Where the heavy frames (over 33 ms of main thread) spent it, ms summed over
   * the window: "n=3 input=1 sim=250 scene=12 render=40"; and "gaps=…", the
   * frames over 50 ms apart whose previous frame was light (the time went elsewhere:
   * garbage collection, the graphics process, the browser).
   */
  'heavy',
] as const;

/** Numbers, double1 onwards. */
export const PERF_DOUBLES = [
  /** Frames per second over the window. */
  'fps',
  /** Frame time, ms: median, 95th percentile, worst. */
  'frameMs',
  'p95Ms',
  'worstMs',
  /** Frames over 50 ms. */
  'hitches',
  /** Main-thread time per frame, ms, from the frame's start to the end of its render calls. */
  'cpuMs',
  /** Of which in the render calls themselves (WebGL submission, not the GPU's own time). */
  'renderMs',
  /** Draw calls and triangles per frame. */
  'calls',
  'triangles',
  /** Pixels drawn per CSS pixel, the picture's size in device pixels, the display's own density. */
  'pixelRatio',
  'bufferWidth',
  'bufferHeight',
  'dpr',
  /** The auto-resolution's scale, and the quality chosen (index). */
  'renderScale',
  'quality',
  /** Seconds the window covers. */
  'seconds',
  /** CPU cores and memory (GB) the browser says it has; 0 when it does not say. */
  'cores',
  'memory',
  /** Shader programs compiled during the window: each can stall a frame the first time. */
  'newPrograms',
  /** Time per frame in the jump's own step (physics, collisions, crash), ms. */
  'simMs',
] as const;

export type PerfReport = { session: string } & { [K in (typeof PERF_BLOBS)[number]]: string } & {
  [K in (typeof PERF_DOUBLES)[number]]: number;
};

/** Largest body accepted, bytes. */
export const PERF_MAX_BYTES = 4096;
