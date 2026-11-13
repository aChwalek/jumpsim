// What the pilot hears: the air rushing past the ears, the canopy flapping
// overhead, and the landing. All of it is shaped from noise on the spot. The
// one exception is optional: sounds of a crash (bones, cries) dropped in
// public/sfx and listed in its index.json play instead of the made-up ones.
//
// The wind is the instrument here. It gets louder and sharper with airspeed,
// so a dive can be heard building up and a flare can be heard dying down.

/** Airspeed in full flight, m/s: the levels below are set at this speed. */
const FULL_FLIGHT = 14;
/** Loudness at full flight of the rush in the ears, the hiss and the flapping. */
export const MIX = { rush: 0.25, hiss: 0.07, flap: 0.2 };
const NOISE_SECONDS = 6;
/** Airspeed above which the wind gets no louder, m/s. */
const LOUDEST = 36;

export interface Hearing {
  /** Speed of the air past the pilot's head, m/s. */
  airspeed: number;
  /** Side it comes from, seen from the head: -1 full left, 1 full right. */
  fromRight: number;
  /** False while the sim is stopped: silence. */
  live: boolean;
  /** How much canopy there is overhead to flap, 0 (none yet, in freefall) to 1. */
  canopy: number;
}

/** The jump plane, as heard from the pilot's head. */
export interface EngineHearing {
  /** From the ears to the propeller, m. */
  distance: number;
  /** How fast that distance shrinks, m/s: negative as the plane flies away. */
  closing: number;
  /** Side it is heard from, seen from the head: -1 full left, 1 full right. */
  fromRight: number;
  /** False while the sim is stopped: silence. */
  live: boolean;
  /** A helicopter: the slap of the main rotor's blades over the tail rotor's buzz. */
  rotor?: boolean;
}

/**
 * Loudness of the plane's parts with the head in the door, about six metres
 * from the propeller: the propeller's buzz, its beating, the turbine's
 * whistle and the exhaust's rumble.
 */
export const ENGINE_MIX = { buzz: 0.6, beat: 1.7, whine: 0.045, rumble: 0.35 };
/** Distance from the propeller to the head in the door, m: the levels above are set there. */
const ENGINE_NEAR = 6;
/**
 * A three-blade propeller at about 1750 rpm on jump run: the blades pass
 * 87 times a second, which is the drone the whole plane hums at.
 */
const BLADE_PASS = 87.5;
/**
 * A helicopter's three-blade main rotor at 390 rpm: the blades pass 19.5
 * times a second, the slap heard as a beat rather than a tone. Its two-blade
 * tail rotor, five times faster, gives the buzz.
 */
const ROTOR_PASS = 19.5;
const TAIL_PASS = 65;
/** How much of the buzz, and of the beat, a helicopter has against a plane. */
const ROTOR_MIX = { buzz: 0.55, beat: 1.25, depth: 0.55 };
/** The gas generator's whistle, Hz. */
const TURBINE = 2950;
const SOUND_SPEED = 343;

export interface Landing {
  /** Downward speed at contact, m/s. */
  sink: number;
  /** Speed over the ground at contact, m/s. */
  groundSpeed: number;
  /** In a pond. */
  wet: boolean;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Smooth random value between 0 and 1 that wanders as `t` goes up. */
function wander(t: number): number {
  const hash = (n: number): number => {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(t);
  const f = t - i;
  return hash(i) + (hash(i + 1) - hash(i)) * f * f * (3 - 2 * f);
}

/** Pink noise that loops without a click, different in each channel. */
export function makeNoise(ctx: BaseAudioContext, channels: number): AudioBuffer {
  const length = Math.round(ctx.sampleRate * NOISE_SECONDS);
  const overlap = 4096;
  const buffer = ctx.createBuffer(channels, length, ctx.sampleRate);
  const raw = new Float32Array(length + overlap);
  for (let c = 0; c < channels; c++) {
    // Paul Kellet's filter: white noise in, 3 dB less per octave out.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < raw.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    // What follows the end is faded into the start, so the loop is seamless.
    const data = buffer.getChannelData(c);
    data.set(raw.subarray(0, length));
    for (let i = 0; i < overlap; i++) {
      const w = i / overlap;
      data[i] = raw[i]! * Math.sqrt(w) + raw[length + i]! * Math.sqrt(1 - w);
    }
  }
  return buffer;
}

/** Everything goes through here: volume, then a limiter for the loud dives. */
export function buildOutput(ctx: BaseAudioContext): GainNode {
  const volume = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.knee.value = 8;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.005;
  limiter.release.value = 0.2;
  volume.connect(limiter);
  limiter.connect(ctx.destination);
  return volume;
}

/** Starts the wind and returns the function that keeps it up to date. */
export function buildWind(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode): (h: Hearing) => void {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const ears = ctx.createChannelSplitter(2);
  const both = ctx.createChannelMerger(2);
  // Nothing below 70 Hz: speakers cannot play it and it would eat the headroom.
  const floor = ctx.createBiquadFilter();
  floor.type = 'highpass';
  floor.frequency.value = 70;
  source.connect(floor);
  floor.connect(ears);
  both.connect(out);

  // The rush: a rumble in each ear, each with its own noise.
  const rush = [0, 1].map((ear) => {
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 0.8;
    const level = ctx.createGain();
    level.gain.value = 0;
    ears.connect(tone, ear);
    tone.connect(level);
    level.connect(both, 0, ear);
    return { tone, level };
  });

  // The hiss of air over the helmet and through the lines: only at speed.
  const hissTone = ctx.createBiquadFilter();
  hissTone.type = 'bandpass';
  hissTone.Q.value = 1.1;
  const hiss = ctx.createGain();
  hiss.gain.value = 0;
  ears.connect(hissTone, 0);
  hissTone.connect(hiss);

  // Slider and stabilisers flapping overhead: noise chopped a few times a
  // second, faster with speed.
  const flapTone = ctx.createBiquadFilter();
  flapTone.type = 'bandpass';
  flapTone.Q.value = 0.7;
  const chop = ctx.createGain();
  chop.gain.value = 0.5;
  const beat = ctx.createOscillator();
  beat.type = 'sawtooth';
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  beat.connect(depth);
  depth.connect(chop.gain);
  const flap = ctx.createGain();
  flap.gain.value = 0;
  ears.connect(flapTone, 1);
  flapTone.connect(chop);
  chop.connect(flap);

  for (const ear of [0, 1]) {
    hiss.connect(both, 0, ear);
    flap.connect(both, 0, ear);
  }
  source.start();
  beat.start();

  return (h) => {
    const now = ctx.currentTime;
    const v = h.live ? h.airspeed : 0;
    // Freefall and the open door are far louder than any dive under canopy;
    // past this the level stops climbing, for the ears' sake, and only the
    // colour of the noise says how fast.
    const x = Math.min(v, LOUDEST) / FULL_FLIGHT;
    const settle = 0.06;
    rush.forEach(({ tone, level }, ear) => {
      // The ear in the lee of the head sits in its wake and gets the most of it.
      const lee = ear === 0 ? h.fromRight : -h.fromRight;
      // Air past an ear is never steady.
      const gust = 0.8 + 0.4 * wander(now * 2.3 + ear * 17.3);
      level.gain.setTargetAtTime(MIX.rush * x ** 2.5 * (1 + 0.35 * lee) * gust, now, settle);
      tone.frequency.setTargetAtTime(200 + 90 * v, now, settle);
    });
    hiss.gain.setTargetAtTime(MIX.hiss * x ** 4, now, settle);
    hissTone.frequency.setTargetAtTime(Math.min(400 + 180 * v, 9000), now, settle);
    flap.gain.setTargetAtTime(MIX.flap * x ** 2 * h.canopy, now, settle);
    flapTone.frequency.setTargetAtTime(500 + 25 * Math.min(v, LOUDEST), now, settle);
    beat.frequency.setTargetAtTime(Math.max(1, 1.4 * Math.min(v, LOUDEST) * (0.85 + 0.3 * wander(now * 0.9 + 5))), now, 0.1);
  };
}

/** Starts the plane's engine and returns the function that keeps it up to date. */
export function buildEngine(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode): (e: EngineHearing | null) => void {
  // Everything goes through the air on its way: far off it loses its highs
  // and its level, and it sits to one side.
  const air = ctx.createBiquadFilter();
  air.type = 'lowpass';
  air.Q.value = 0.5;
  const level = ctx.createGain();
  level.gain.value = 0;
  const side = ctx.createStereoPanner();
  air.connect(level);
  level.connect(side);
  side.connect(out);

  // The buzz: the blades' pressure pulses, rich in harmonics, softened.
  const blades = ctx.createOscillator();
  blades.type = 'sawtooth';
  const second = ctx.createOscillator();
  second.type = 'triangle';
  const buzzTone = ctx.createBiquadFilter();
  buzzTone.type = 'lowpass';
  // Laptop speakers give little below 150 Hz: the harmonics carry the drone.
  buzzTone.frequency.value = 1100;
  buzzTone.Q.value = 0.9;
  const secondLevel = ctx.createGain();
  secondLevel.gain.value = 0.45;
  const buzz = ctx.createGain();
  buzz.gain.value = ENGINE_MIX.buzz;
  blades.connect(buzzTone);
  second.connect(secondLevel);
  secondLevel.connect(buzzTone);
  buzzTone.connect(buzz);
  buzz.connect(air);

  // The beat: broadband noise from the blades, chopped at the blade rate.
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const beatTone = ctx.createBiquadFilter();
  beatTone.type = 'bandpass';
  beatTone.frequency.value = 520;
  beatTone.Q.value = 0.7;
  const chop = ctx.createGain();
  chop.gain.value = 0.55;
  const pulse = ctx.createOscillator();
  pulse.type = 'sine';
  const depth = ctx.createGain();
  depth.gain.value = 0.45;
  pulse.connect(depth);
  depth.connect(chop.gain);
  const beat = ctx.createGain();
  beat.gain.value = ENGINE_MIX.beat;
  source.connect(beatTone);
  beatTone.connect(chop);
  chop.connect(beat);
  beat.connect(air);

  // The rumble of the exhaust, low and steady.
  const rumbleTone = ctx.createBiquadFilter();
  rumbleTone.type = 'lowpass';
  rumbleTone.frequency.value = 220;
  rumbleTone.Q.value = 0.7;
  const rumble = ctx.createGain();
  rumble.gain.value = ENGINE_MIX.rumble;
  source.connect(rumbleTone);
  rumbleTone.connect(rumble);
  rumble.connect(air);

  // The turbine's whistle, which wavers a little.
  const whistle = ctx.createOscillator();
  whistle.type = 'sine';
  const whine = ctx.createGain();
  whine.gain.value = ENGINE_MIX.whine;
  whistle.connect(whine);
  whine.connect(air);

  for (const node of [blades, second, pulse, whistle, source]) node.start();

  return (e) => {
    const now = ctx.currentTime;
    const settle = 0.05;
    if (!e || !e.live) {
      level.gain.setTargetAtTime(0, now, settle);
      return;
    }
    // Spreading: half as loud each time the distance doubles.
    level.gain.setTargetAtTime(Math.min(1.5, ENGINE_NEAR / Math.max(e.distance, 1)), now, settle);
    air.frequency.setTargetAtTime(Math.min(16000, 14000 / (1 + e.distance / 120)), now, settle);
    side.pan.setTargetAtTime(Math.max(-1, Math.min(1, 0.85 * e.fromRight)), now, settle);
    // Doppler: higher while the plane closes in, lower as it pulls away.
    const shift = SOUND_SPEED / Math.max(SOUND_SPEED * 0.5, SOUND_SPEED - e.closing);
    // A plane's propeller gives both the drone and the beat; a helicopter's tail rotor the drone, its main rotor the beat.
    const pass = (e.rotor ? TAIL_PASS : BLADE_PASS) * shift;
    blades.frequency.setTargetAtTime(pass, now, settle);
    second.frequency.setTargetAtTime(2 * pass, now, settle);
    pulse.frequency.setTargetAtTime(e.rotor ? ROTOR_PASS * shift : pass, now, settle);
    depth.gain.setTargetAtTime(e.rotor ? ROTOR_MIX.depth : 0.45, now, settle);
    buzz.gain.setTargetAtTime(ENGINE_MIX.buzz * (e.rotor ? ROTOR_MIX.buzz : 1), now, settle);
    beat.gain.setTargetAtTime(ENGINE_MIX.beat * (e.rotor ? ROTOR_MIX.beat : 1), now, settle);
    beatTone.frequency.setTargetAtTime((e.rotor ? 320 : 520) * shift, now, settle);
    whistle.frequency.setTargetAtTime(TURBINE * shift * (1 + 0.004 * Math.sin(now * 1.7)), now, settle);
  };
}

/** A dull knock: feet on the ground. */
function thump(ctx: BaseAudioContext, out: AudioNode, level: number): void {
  const now = ctx.currentTime;
  const tone = ctx.createOscillator();
  tone.frequency.setValueAtTime(95, now);
  tone.frequency.exponentialRampToValueAtTime(42, now + 0.14);
  const fade = ctx.createGain();
  fade.gain.setValueAtTime(0.0001, now);
  fade.gain.exponentialRampToValueAtTime(level, now + 0.004);
  fade.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
  tone.connect(fade);
  fade.connect(out);
  tone.start(now);
  tone.stop(now + 0.35);
}

interface Burst {
  type: BiquadFilterType;
  /** The filter slides from one frequency to the other, Hz. */
  from: number;
  to: number;
  level: number;
  seconds: number;
}

/** A burst of filtered noise that dies away. */
function burst(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, b: Burst): void {
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const tone = ctx.createBiquadFilter();
  tone.type = b.type;
  tone.Q.value = 0.7;
  tone.frequency.setValueAtTime(b.from, now);
  tone.frequency.exponentialRampToValueAtTime(b.to, now + b.seconds);
  const fade = ctx.createGain();
  fade.gain.setValueAtTime(0.0001, now);
  fade.gain.exponentialRampToValueAtTime(b.level, now + 0.008);
  fade.gain.exponentialRampToValueAtTime(0.0001, now + b.seconds);
  source.connect(tone);
  tone.connect(fade);
  fade.connect(out);
  source.start(now, Math.random() * (NOISE_SECONDS - b.seconds - 0.1));
  source.stop(now + b.seconds + 0.05);
}

/** Feet hitting the grass and scuffing along it, or going into the water. */
export function playLanding(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, l: Landing): void {
  const hit = clamp01(l.sink / 5);
  const run = clamp01(l.groundSpeed / 10);
  if (l.wet) {
    thump(ctx, out, 0.2 + 0.3 * hit);
    burst(ctx, noise, out, { type: 'lowpass', from: 7000, to: 600, level: 1.2 + 1.2 * Math.max(hit, run), seconds: 1.1 });
    burst(ctx, noise, out, { type: 'bandpass', from: 3500, to: 1500, level: 0.8, seconds: 0.6 });
  } else {
    thump(ctx, out, 0.25 + 0.65 * hit);
    burst(ctx, noise, out, { type: 'bandpass', from: 900, to: 500, level: 0.6 + 2.4 * run, seconds: 0.25 + (l.groundSpeed > 6 ? 0.2 : 0.05) * l.groundSpeed });
  }
}

/** One foot coming down on the grass, harder at a run. */
export function playStep(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, groundSpeed: number): void {
  const run = clamp01(groundSpeed / 6);
  thump(ctx, out, 0.08 + 0.12 * run);
  burst(ctx, noise, out, { type: 'bandpass', from: 1400, to: 700, level: 0.25 + 0.5 * run, seconds: 0.12 });
}

/**
 * How a crash sounds: the body hitting the ground, bones going, and the
 * pilot's opinion of it. `rate` slows it all down for a slow-motion replay,
 * 1 at normal speed.
 */
export type Ouch = 'hit' | 'crack' | 'cry' | 'groan';

/** One knock of the body on the ground, duller and longer for the trunk. */
export function playBodyHit(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, level: number, rate = 1): void {
  const now = ctx.currentTime;
  const tone = ctx.createOscillator();
  tone.frequency.setValueAtTime(120 * rate, now);
  tone.frequency.exponentialRampToValueAtTime(38 * rate, now + 0.18 / rate);
  const fade = ctx.createGain();
  fade.gain.setValueAtTime(0.0001, now);
  fade.gain.exponentialRampToValueAtTime(0.9 * level, now + 0.004);
  fade.gain.exponentialRampToValueAtTime(0.0001, now + 0.32 / rate);
  tone.connect(fade);
  fade.connect(out);
  tone.start(now);
  tone.stop(now + 0.4 / rate);
  burst(ctx, noise, out, { type: 'lowpass', from: 1800 * rate, to: 250 * rate, level: 1.4 * level, seconds: 0.18 / rate });
}

/**
 * A bone going: a sharp snap with a splintering crackle after it, like a
 * stick of celery broken in a towel.
 */
export function playCrack(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, level: number, rate = 1): void {
  const now = ctx.currentTime;
  const snaps = 3 + Math.floor(Math.random() * 4);
  let at = now;
  for (let i = 0; i < snaps; i++) {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const tone = ctx.createBiquadFilter();
    tone.type = 'bandpass';
    tone.Q.value = 1.6;
    tone.frequency.value = (1800 + Math.random() * 2600) * rate;
    const bright = ctx.createBiquadFilter();
    bright.type = 'highpass';
    bright.frequency.value = 700 * rate;
    const fade = ctx.createGain();
    const first = i === 0;
    const peak = level * (first ? 5 : 1.2 + Math.random() * 1.8);
    const length = (first ? 0.035 : 0.008 + Math.random() * 0.018) / rate;
    fade.gain.setValueAtTime(0.0001, at);
    fade.gain.exponentialRampToValueAtTime(peak, at + 0.0015);
    fade.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(tone);
    tone.connect(bright);
    bright.connect(fade);
    fade.connect(out);
    source.start(at, Math.random() * (NOISE_SECONDS - 0.2));
    source.stop(at + length + 0.02);
    at += (first ? 0.012 : 0.006 + Math.random() * 0.03) / rate;
  }
  // The wooden knock of it under the snap.
  const knock = ctx.createOscillator();
  knock.type = 'triangle';
  knock.frequency.setValueAtTime(420 * rate, now);
  knock.frequency.exponentialRampToValueAtTime(160 * rate, now + 0.06 / rate);
  const fade = ctx.createGain();
  fade.gain.setValueAtTime(0.0001, now);
  fade.gain.exponentialRampToValueAtTime(0.7 * level, now + 0.002);
  fade.gain.exponentialRampToValueAtTime(0.0001, now + 0.09 / rate);
  knock.connect(fade);
  fade.connect(out);
  knock.start(now);
  knock.stop(now + 0.12 / rate);
}

/** Formants of a few vowels, Hz, and how loud each is. */
const VOWELS = {
  a: [800, 1250, 2600],
  e: [450, 1900, 2600],
  i: [300, 2300, 3000],
  o: [470, 820, 2500],
  u: [330, 750, 2400],
} as const;
type Vowel = keyof typeof VOWELS;

/** A voice made of a buzz through three formants: crude, but it says it. */
function voice(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  rate: number,
  level: number,
  pitch: [number, number][],
  vowels: [number, Vowel][],
  seconds: number,
): void {
  const now = ctx.currentTime;
  const end = now + seconds / rate;
  const at = (t: number) => now + t / rate;
  const glottis = ctx.createOscillator();
  glottis.type = 'sawtooth';
  glottis.frequency.setValueAtTime(pitch[0]![1] * rate, now);
  for (const [t, f] of pitch.slice(1)) glottis.frequency.linearRampToValueAtTime(f * rate, at(t));
  // A strained, shaky voice.
  const shake = ctx.createOscillator();
  shake.frequency.value = 7 + Math.random() * 3;
  const shakeDepth = ctx.createGain();
  shakeDepth.gain.value = 6 * rate;
  shake.connect(shakeDepth);
  shakeDepth.connect(glottis.frequency);
  // Some breath in it.
  const breath = ctx.createBufferSource();
  breath.buffer = noise;
  const breathLevel = ctx.createGain();
  breathLevel.gain.value = 0.25;
  breath.connect(breathLevel);

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(level, at(0.04));
  envelope.gain.setValueAtTime(level, at(seconds * 0.6));
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);
  envelope.connect(out);

  const gains = [1, 0.5, 0.18];
  for (let f = 0; f < 3; f++) {
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.Q.value = 6 + 4 * f;
    const [t0, v0] = vowels[0]!;
    formant.frequency.setValueAtTime(VOWELS[v0][f]! * Math.sqrt(rate), at(t0));
    for (const [t, v] of vowels.slice(1)) formant.frequency.linearRampToValueAtTime(VOWELS[v][f]! * Math.sqrt(rate), at(t));
    const gain = ctx.createGain();
    gain.gain.value = gains[f]! * 4;
    glottis.connect(formant);
    breathLevel.connect(formant);
    formant.connect(gain);
    gain.connect(envelope);
  }
  glottis.start(now);
  shake.start(now);
  breath.start(now, Math.random() * (NOISE_SECONDS - seconds / rate - 0.1));
  glottis.stop(end + 0.05);
  shake.stop(end + 0.05);
  breath.stop(end + 0.05);
}

/** A cry on the hit: "aïe!", "ouh!" or "ah!", high and short. */
export function playCry(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, level: number, rate = 1): void {
  const base = 210 + Math.random() * 60;
  const cries: [[number, number][], [number, Vowel][], number][] = [
    // Aïe
    [[[0, base * 1.3], [0.12, base * 1.7], [0.5, base * 1.1]], [[0, 'a'], [0.22, 'a'], [0.4, 'i']], 0.55],
    // Ouh
    [[[0, base * 1.6], [0.1, base * 1.8], [0.45, base]], [[0, 'u'], [0.45, 'o']], 0.5],
    // Aaah
    [[[0, base * 1.5], [0.15, base * 1.9], [0.7, base * 1.2]], [[0, 'a'], [0.7, 'e']], 0.75],
  ];
  const [pitch, vowels, seconds] = cries[Math.floor(Math.random() * cries.length)]!;
  voice(ctx, out, noise, rate, 0.18 * level, pitch, vowels, seconds);
}

/** Lying there afterwards: a long, low "ooohhh". */
export function playGroan(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, level: number, rate = 1): void {
  const base = 120 + Math.random() * 25;
  voice(ctx, out, noise, rate, 0.4 * level, [[0, base * 1.15], [0.4, base * 1.25], [1.6, base * 0.85]], [[0, 'o'], [0.9, 'o'], [1.6, 'u']], 1.6);
}

/** Sounds dropped in public/sfx, by kind: the file names listed in its index.json. */
type Samples = Partial<Record<Ouch, AudioBuffer[]>>;

async function loadSamples(ctx: BaseAudioContext): Promise<Samples> {
  const base = `${import.meta.env.BASE_URL}sfx/`;
  const found: Samples = {};
  try {
    const response = await fetch(`${base}index.json`);
    if (!response.ok) return found;
    const index = (await response.json()) as Partial<Record<Ouch, string[]>>;
    await Promise.all(
      (Object.keys(index) as Ouch[]).map(async (kind) => {
        const buffers = await Promise.all(
          (index[kind] ?? []).map(async (name) => {
            try {
              const file = await fetch(base + name);
              return file.ok ? await ctx.decodeAudioData(await file.arrayBuffer()) : null;
            } catch {
              return null;
            }
          }),
        );
        const usable = buffers.filter((b): b is AudioBuffer => b !== null);
        if (usable.length) found[kind] = usable;
      }),
    );
  } catch {
    // No index, or not JSON (a dev server answers with the page): none.
  }
  return found;
}

function playSample(ctx: BaseAudioContext, out: AudioNode, buffer: AudioBuffer, level: number, rate: number): void {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const gain = ctx.createGain();
  gain.gain.value = level;
  source.connect(gain);
  gain.connect(out);
  source.start();
}

/** A run of beeps from the piezo of an audible altimeter. */
export interface Beeps {
  count: number;
  /** Length of each beep and of the silence after it, s. */
  seconds: number;
  gap: number;
}

/** Beeps of an audible altimeter: a piezo in the helmet, high and penetrating. */
export function playBeeps(ctx: BaseAudioContext, out: AudioNode, b: Beeps): void {
  const now = ctx.currentTime;
  const tone = ctx.createOscillator();
  tone.type = 'square';
  tone.frequency.value = 3100;
  // The piezo and the helmet foam take the edge off the square.
  const soften = ctx.createBiquadFilter();
  soften.type = 'lowpass';
  soften.frequency.value = 4500;
  const gate = ctx.createGain();
  gate.gain.value = 0;
  for (let i = 0; i < b.count; i++) {
    const start = now + 0.02 + i * (b.seconds + b.gap);
    gate.gain.setValueAtTime(0, start);
    gate.gain.linearRampToValueAtTime(0.09, start + 0.004);
    gate.gain.setValueAtTime(0.09, start + b.seconds - 0.004);
    gate.gain.linearRampToValueAtTime(0, start + b.seconds);
  }
  tone.connect(soften);
  soften.connect(gate);
  gate.connect(out);
  tone.start(now);
  tone.stop(now + 0.05 + b.count * (b.seconds + b.gap));
}

/** The sound of the sim in the page. Silent until `wake` is called. */
export class Sound {
  muted = false;
  /** 0 to 1, under the mute. */
  private level = 1;
  private ctx: AudioContext | null = null;
  private volume: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private wind: ((h: Hearing) => void) | null = null;
  private engine: ((e: EngineHearing | null) => void) | null = null;
  private samples: Samples = {};

  constructor() {
    // The picture stops when the tab is hidden; so must the wind.
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** Browsers only let sound start from a click or a key press: call this from one. */
  wake(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.volume = buildOutput(this.ctx);
      this.volume.gain.value = this.gain;
      this.noise = makeNoise(this.ctx, 2);
      this.wind = buildWind(this.ctx, this.noise, this.volume);
      this.engine = buildEngine(this.ctx, this.noise, this.volume);
      void loadSamples(this.ctx).then((found) => (this.samples = found));
    }
    if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
  }

  /** Sound on or off, and how loud, 0 to 1. */
  set(on: boolean, level: number): void {
    this.muted = !on;
    this.level = Math.min(1, Math.max(0, level));
    if (this.ctx && this.volume) this.volume.gain.setTargetAtTime(this.gain, this.ctx.currentTime, 0.03);
  }

  /** Squared, so that the slider sounds more even: half way is -12 dB. */
  private get gain(): number {
    return this.muted ? 0 : this.level * this.level;
  }

  /** Call every frame. */
  update(h: Hearing): void {
    this.wind?.(h);
  }

  /** The jump plane, or null when there is none. Call every frame. */
  hearPlane(e: EngineHearing | null): void {
    this.engine?.(e);
  }

  land(l: Landing): void {
    if (this.ctx && this.noise && this.volume) playLanding(this.ctx, this.noise, this.volume, l);
  }

  /** The audible altimeter going off. */
  beep(b: Beeps): void {
    if (this.ctx && this.volume) playBeeps(this.ctx, this.volume, b);
  }

  /**
   * A crash sound, `level` 0 to 1, slowed down by `rate` for a slow-motion
   * replay. One of the sounds in public/sfx if there are any of that kind.
   */
  ouch(kind: Ouch, level: number, rate = 1): void {
    const { ctx, noise, volume } = this;
    if (!ctx || !noise || !volume) return;
    const files = this.samples[kind];
    if (files) {
      playSample(ctx, volume, files[Math.floor(Math.random() * files.length)]!, level, rate);
      return;
    }
    const play = { hit: playBodyHit, crack: playCrack, cry: playCry, groan: playGroan }[kind];
    play(ctx, noise, volume, level, rate);
  }

  /** A footfall on the ground, at this ground speed in m/s. */
  step(groundSpeed: number): void {
    if (this.ctx && this.noise && this.volume) playStep(this.ctx, this.noise, this.volume, groundSpeed);
  }
}
