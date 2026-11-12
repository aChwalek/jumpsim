import { expect, test } from 'vitest';
import {
  BEFORE_EXIT,
  SAMPLE_EVERY,
  TrackPlayer,
  TrackRecorder,
  decodeTrack,
  encodeTrack,
  makeTrackFrame,
  type Track,
  type TrackFrame,
} from '../src/replay/track';
import { cloneSetup, defaultSetup } from '../src/setup';
import { JOINT_COUNT } from '../src/sim/ragdoll';

const FRAME = 1 / 60;

/**
 * A jump made up for the tests, frame by frame at 60 a second: `door`
 * seconds in the plane, 50 of freefall, 3 opening, `canopy` under it,
 * 2 on the ground thrown about, every number moving.
 */
function recordJump(door = 20, canopy = 180): { recorder: TrackRecorder; track: Track } {
  const recorder = new TrackRecorder();
  recorder.begin(cloneSetup(defaultSetup()), 'plane');
  const f = makeTrackFrame();
  recorder.setPlane('pc6', { x: 0, y: 4000, z: 0 }, { x: 0, y: 0, z: -38 }, { x: 0, y: 0, z: 0, w: 1 });
  const end = door + 50 + 3 + canopy + 2;
  for (let t = 0; t < end; t += FRAME) {
    f.phase = t < door ? 'plane' : t < door + 50 ? 'freefall' : t < door + 53 ? 'opening' : 'canopy';
    f.inflation = t < door + 50.5 ? null : Math.min(1, (t - door - 50.5) / 2);
    f.deploy = f.inflation === null ? 'stowed' : 'canopy';
    f.landed = t >= end - 2;
    f.pos.x = 30 * Math.sin(t / 40);
    f.pos.y = 4000 - Math.max(0, t - door) * 15;
    f.pos.z = -38 * Math.min(t, door) + 5 * Math.cos(t / 25);
    f.vel.x = Math.cos(t / 40);
    f.vel.y = t < door ? 0 : -15;
    f.vel.z = -5;
    const yaw = t / 30;
    f.att.y = f.pilotAtt.y = Math.sin(yaw / 2);
    f.att.w = f.pilotAtt.w = Math.cos(yaw / 2);
    f.controls.brakeL = f.hands.brakeL = 0.5 + 0.5 * Math.sin(t);
    f.pose.hipL = 0.4 * Math.sin(t * 2);
    f.pose.handL.set(-0.2, 0.1 * Math.sin(t), -0.3);
    f.heading = yaw;
    f.distance = 8;
    f.focus.y = 3;
    f.hasJoints = f.landed;
    for (let i = 0; i < 3 * JOINT_COUNT; i++) f.joints[i] = f.pos.y + i * 0.01 + Math.sin(t + i);
    if (recorder.tick(FRAME, f.hasJoints)) recorder.push(f);
    if (t >= door + 60 && t < door + 60 + FRAME) recorder.hear({ kind: 'beep', count: 3, seconds: 0.1, gap: 0.1 });
  }
  recorder.hear({ kind: 'ouch', ouch: 'hit', level: 0.8 });
  recorder.logged(12, 1_700_000_000_000);
  const track = recorder.finish();
  if (!track) throw new Error('no track');
  return { recorder, track };
}

test('a jump is kept twenty times a second, every frame once on the ground thrown about', () => {
  const { track } = recordJump();
  const p = new TrackPlayer(track);
  // The door cut to its last seconds, so the recording starts just before the exit.
  expect(p.start).toBeGreaterThan(20 - BEFORE_EXIT - 0.1);
  expect(p.start).toBeLessThan(20 - BEFORE_EXIT + SAMPLE_EVERY + 0.1);
  // To within a sample.
  const near = (t: number | null, at: number) => expect(Math.abs(t! - at)).toBeLessThanOrEqual(SAMPLE_EVERY + 2 * FRAME);
  near(p.marks.exit, 20);
  near(p.marks.open, 73);
  near(p.marks.landing, 253);
  const flying = (253 - p.start) / SAMPLE_EVERY;
  const thrown = 2 / FRAME;
  expect(track.count).toBeGreaterThan(flying + thrown - 10);
  expect(track.count).toBeLessThan(flying + thrown + 10);
  expect(track.joints.length / (3 * JOINT_COUNT)).toBeCloseTo(thrown, -1);
});

test('nothing is kept of a jump that never went in the logbook', () => {
  const recorder = new TrackRecorder();
  recorder.begin(cloneSetup(defaultSetup()), 'pattern');
  const f = makeTrackFrame();
  for (let i = 0; i < 100; i++) if (recorder.tick(FRAME, false)) recorder.push(f);
  expect(recorder.finish()).toBeNull();
  expect(recorder.recording).toBe(false);
});

test('a track reads back as it was written', () => {
  const { track } = recordJump(10, 30);
  const bytes = encodeTrack(track);
  const back = decodeTrack(bytes);
  expect(back).not.toBeNull();
  expect(back!.meta).toEqual(track.meta);
  expect(back!.count).toBe(track.count);
  expect(Array.from(back!.base)).toEqual(Array.from(track.base));
  expect(Array.from(back!.joints)).toEqual(Array.from(track.joints));
  expect(Array.from(back!.released)).toEqual(Array.from(track.released));
  // Anything else is not a track.
  expect(decodeTrack(bytes.slice(0, bytes.length / 2))).toBeNull();
  expect(decodeTrack(new Uint8Array([1, 2, 3, 4, 5, 6]))).toBeNull();
});

test('a five-minute jump takes a few hundred kB at most, gzipped far less', async () => {
  const { track } = recordJump(20, 240);
  const bytes = encodeTrack(track);
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('gzip'));
  const gzipped = (await new Response(stream).arrayBuffer()).byteLength;
  expect(bytes.length).toBeLessThan(600_000);
  expect(gzipped).toBeLessThan(bytes.length * 0.6);
});

test('the replay goes between two samples, the short way round', () => {
  const recorder = new TrackRecorder();
  recorder.begin(cloneSetup(defaultSetup()), 'pattern');
  const f = makeTrackFrame();
  const put = (x: number, yaw: number, heading: number, deploy: TrackFrame['deploy']) => {
    f.pos.x = x;
    f.att.y = Math.sin(yaw / 2);
    f.att.w = Math.cos(yaw / 2);
    f.heading = heading;
    f.deploy = deploy;
    recorder.push(f);
  };
  recorder.tick(0, false);
  put(0, 0, 3.1, 'bag');
  recorder.tick(1, false);
  // Same attitude, written the other way round: no spin in between.
  f.att.x = 0;
  put(10, 0.2, -3.1, 'canopy');
  f.att.y = -f.att.y;
  recorder.logged(1, 1);
  const track = recorder.finish()!;
  const p = new TrackPlayer(track);
  p.seek(0.5);
  expect(p.frame.pos.x).toBeCloseTo(5, 3);
  expect(Math.abs(p.frame.att.w)).toBeGreaterThan(0.99);
  // Round the back of the circle, not through zero.
  expect(Math.abs(p.frame.heading)).toBeGreaterThan(3.1);
  // Steps are the sample before's until the next.
  expect(p.frame.deploy).toBe('bag');
  p.seek(5);
  expect(p.time).toBe(1);
  expect(p.done).toBe(true);
});

test('sounds play as the replay reaches them, not when it jumps there, nor too fast', () => {
  const { track } = recordJump(10, 30);
  const p = new TrackPlayer(track);
  const heard: string[] = [];
  const hear = (e: { kind: string }) => heard.push(e.kind);
  p.seek(10 + 59);
  p.advance(2, hear);
  expect(heard).toEqual(['beep']);
  // Jumping past one: not heard.
  p.seek(p.end - 0.5);
  expect(heard).toEqual(['beep']);
  p.advance(1, hear);
  expect(heard).toEqual(['beep', 'ouch']);
  // Played back too fast to make sense of: not heard either.
  p.seek(10 + 59);
  p.speed = 8;
  p.advance(0.5, hear);
  expect(heard).toEqual(['beep', 'ouch']);
  // Paused, nothing moves.
  p.paused = true;
  const at = p.time;
  p.advance(1, hear);
  expect(p.time).toBe(at);
});

test('the speed goes up and down the steps, and stays within them', () => {
  const { track } = recordJump(10, 10);
  const p = new TrackPlayer(track);
  p.faster(1);
  expect(p.speed).toBe(2);
  for (let i = 0; i < 10; i++) p.faster(1);
  expect(p.speed).toBe(8);
  for (let i = 0; i < 10; i++) p.faster(-1);
  expect(p.speed).toBe(0.25);
});
