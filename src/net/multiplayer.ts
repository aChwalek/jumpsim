import { isSmoke } from '../render/smoke';
import { DEFAULT_GLOW, DEFAULT_HELMET, DEFAULT_SUIT, isGlowColor, isOutfitColor } from '../render/outfit';
import * as THREE from 'three';
import type { Lighting } from '../render/scene';
import { isCanopyColor } from '../render/canopyColors';
import { CANOPY_SIZES, nearestSize, validWeight, type Gear, type Start } from '../setup';
import { isSuitKind, isSuitLevel } from '../sim/suit';
import { dzInfo, type DzId } from '../world/dzs';
import { Markers, type MarkerTarget } from './markers';
import { Mesh } from './mesh';
import { ROOM_NAME } from './protocol';
import { RemoteJumper, type RemoteFrame } from './remote';
import {
  LOAD_EVERY_MS,
  RoomState,
  bestOffset,
  clockSample,
  cleanName,
  nextLoad,
  publicDz,
  readRoomMessage,
  sharedPart,
  type ClockSample,
  type RoomMessage,
  type SharedSetup,
} from './room';
import { decodeSnapshot, emptySnapshot, encodeSnapshot, type Snapshot } from './snapshot';
import type { OtherBody } from '../bots';
import type { OtherJumper } from '../replay/track';
import { vec3, type Vec3 } from '../sim/vec';
import { TimeTrack, clockApart, compareSeen, readSeen, readTick, spread, type Seen, type Tick, type Tock } from './check';

/** Snapshots sent a second. */
const SEND_RATE = 15;
/** Not heard of for this long, ms: no longer drawn. */
const SILENT_MS = 3000;
/** After a start, not another on its own for this long, ms: the ready flags have to settle. */
const START_SETTLE_MS = 3000;
/** How often a public room looks whether its load has left, ms. */
const LOAD_CHECK_MS = 250;
/**
 * The server is asked the time a few times in a row on coming in, this far
 * apart; then every second for a while, then now and again, ms. An answer read
 * late, the page busy (the drop zone loading as we come in), puts the clock off
 * by half the wait: 200 ms busy is 100 ms off, 6 m of a fall. Asked often at
 * first, a quick answer soon comes through, and sets it right.
 */
const TIME_BURST = 5;
const TIME_BURST_GAP_MS = 300;
const TIME_FIRST_MS = 1000;
const TIME_FIRST_ASKS = 30;
const TIME_EVERY_MS = 10_000;
/** The last answers kept: the quickest one sets the clock. A trip longer than this is not one, ms. */
const TIME_KEPT = 16;
const TIME_TRIP_MAX_MS = 5000;
/** Each tells the others where they draw them this often, ms; and compares clocks with them. */
const SEEN_EVERY_MS = 500;
const TICK_EVERY_MS = 2000;
/** The last comparisons of clocks kept with each: the quickest one counts. */
const TICKS_KEPT = 8;

/** What the room tells the sim. */
export interface RoomEvents {
  /** What everyone jumps with, from whoever leads. Not called on the one who leads. */
  setup(shared: SharedSetup): void;
  /** Everyone goes, now. `at`: when the load left, server clock (ms): its plane flies by it. */
  start(start: Start, shared: SharedSetup, at: number): void;
  /** Who is in, who leads, who is ready: something changed. */
  changed(): void;
  /** Someone at our drop zone left their plane. */
  exited(name: string): void;
  /** Seated in another room than asked: the drop zone's public room was full, this is one opened past it. */
  moved(room: string): void;
}

/** Who a player is, sent once on connecting and again when it changes. */
export interface Hello {
  type: 'hello';
  dz: DzId;
  gear: Gear;
}

/** The room in the page's address (`?room=name`), if any. */
export function roomFromUrl(): string | null {
  const room = new URLSearchParams(location.search).get('room')?.toLowerCase() ?? null;
  return room && ROOM_NAME.test(room) ? room : null;
}

/** Puts a room in the page's address, or takes it out, without reloading. */
export function setRoomInUrl(room: string | null): void {
  const url = new URL(location.href);
  if (room) url.searchParams.set('room', room);
  else url.searchParams.delete('room');
  history.replaceState(history.state, '', url);
}

const signalUrl = (room: string): string => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal/${room}`;

/** The address to give the others for a room. */
export function roomLink(room: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', room);
  return url.toString();
}

/** How many are in a public room now; null if the server cannot say. */
export async function playersIn(room: string): Promise<number | null> {
  try {
    const response = await fetch(`/players/${room}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const { players } = (await response.json()) as { players?: unknown };
    return typeof players === 'number' ? players : null;
  } catch {
    return null;
  }
}

/** A new room's name: hard to guess, easy to read out. */
export function newRoomName(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `saut-${[...bytes].map((b) => letters[b % letters.length]).join('')}`;
}

/**
 * Jumping with others: our jumper goes out to the room, theirs come in and are
 * drawn. Each sim stays on its own machine.
 */
export class Multiplayer {
  /** Fill in to send: our jumper now. */
  readonly out: Snapshot = emptySnapshot();
  private readonly mesh: Mesh;
  private readonly remotes = new Map<string, { jumper: RemoteJumper; hello: Hello | null }>();
  private hello: Hello | null = null;
  private sinceSent = Number.POSITIVE_INFINITY;
  private readonly received = emptySnapshot();
  /** Who is in the room, who leads, who is ready. */
  readonly state = new RoomState();
  private name: string;
  private ready = false;
  /** What we jump with: what the room jumps with when we lead. */
  private shared: SharedSetup | null = null;
  private startedAt = Number.NEGATIVE_INFINITY;
  private readonly markers = new Markers(document.getElementById('hud') ?? document.body);
  private readonly targets: MarkerTarget[] = [];
  /** A drop zone's public room: nobody leads the start, loads leave on the clock. */
  readonly isPublic: boolean;
  /** A public room whose loads leave on the clock; at a BASE site there is no plane: each goes when ready. */
  readonly onClock: boolean;
  /** The server's clock minus ours (Date.now), ms: what the loads go by, and their planes. */
  private clockOffset = 0;
  private readonly clockSamples: ClockSample[] = [];
  private timeAsked = 0;
  private timeBurst: number[] = [];
  /** Asked since coming in: often at first. */
  private asks = 0;
  /** Where we were, by the room's clock; and where we drew each of the others. */
  private readonly selfTrack = new TimeTrack();
  private readonly seenTracks = new Map<string, TimeTrack>();
  private seenSentAt = Number.NEGATIVE_INFINITY;
  /** How far off the others draw us, and how far apart their view and ours are, m: for the reports, then for the overlay. */
  private offs: number[] = [];
  private aparts: number[] = [];
  private leads: number[] = [];
  private readonly lastSeen = new Map<string, { off: number; apart: number | null }>();
  /** What the others told us before our clock got there: looked at once it has. */
  private pendingSeen: { id: string; told: Seen }[] = [];
  /** Each one's clock against ours, peer to peer: the last answers (ms). */
  private readonly ticks = new Map<string, { trip: number; apart: number }[]>();
  private tickSentAt = Number.NEGATIVE_INFINITY;
  /** With `?net` in the address: how each one sees us, and the clock, over the picture. */
  private readonly overlay: HTMLElement | null = new URLSearchParams(location.search).has('net') ? netOverlay() : null;
  private overlayAt = 0;
  /** When the load we wait for leaves, server clock, ms. */
  private loadSlot = 0;
  private loadTimer = 0;
  /** Which of the last load to leave we are, 0 the first: each has a place of their own in the plane. */
  seat = 0;
  /** The room we are in: the one asked, or one of its drop zone's opened past it when full. */
  private where: string;
  /** Refused, the room full: we call back now and then. */
  private refused = false;

  constructor(
    room: string,
    private readonly scene: THREE.Scene,
    private readonly light: () => Lighting,
    name: string,
    private readonly events: RoomEvents,
  ) {
    this.name = cleanName(name);
    this.where = room;
    const pinned = publicDz(room);
    this.isPublic = pinned !== null;
    this.onClock = pinned !== null && !dzInfo(pinned).base;
    if (this.onClock) {
      this.loadSlot = nextLoad(this.serverNow());
      this.loadTimer = window.setInterval(() => this.rotate(), LOAD_CHECK_MS);
    }
    this.mesh = new Mesh(signalUrl(room), '/turn', {
      welcome: (you, peers, seated) => {
        this.refused = false;
        // Only ever to another of the same drop zone's: a private room is the one in the link.
        if (seated && seated !== this.where && ROOM_NAME.test(seated) && pinned && publicDz(seated) === pinned) {
          this.where = seated;
          this.mesh.follow(signalUrl(seated));
          this.events.moved(seated);
        }
        // Told when we came in by the server's clock, a one-way trip ago: until it has answered the time.
        if (this.clockSamples.length === 0) this.clockOffset = you.joined - Date.now();
        this.loadSlot = nextLoad(this.serverNow());
        this.asks = 0;
        this.askTime();
        this.state.welcome(you, peers, this.name, this.ready);
        this.sayHello();
        this.leading();
      },
      joined: (member) => {
        this.state.join(member);
        // They know nobody yet: everyone says who they are, and whoever leads what the jump is.
        this.sayHello();
        if (this.state.isHost) this.sendSetup();
        this.events.changed();
      },
      left: (id) => {
        this.state.leave(id);
        this.leading();
      },
      offline: (full) => {
        this.refused = full;
        this.state.players.clear();
        this.state.selfId = null;
        this.events.changed();
      },
      room: (from, data) => this.onRoom(from, data),
      open: (id) => {
        if (this.hello) this.mesh.sendControlTo(id, JSON.stringify(this.hello));
      },
      close: (id) => {
        this.remotes.get(id)?.jumper.dispose();
        this.remotes.delete(id);
        this.seenTracks.delete(id);
        this.lastSeen.delete(id);
        this.ticks.delete(id);
        this.markers.remove(id);
      },
      state: (id, data) => {
        const s = decodeSnapshot(data, this.received);
        if (s) this.remote(id).jumper.buffer.push(s, performance.now());
      },
      control: (id, data) => this.onControl(id, data),
      time: (sent, now) => this.onTime(sent, now),
    });
    this.askLater();
  }

  /** The room we are in: the one asked, or one of its drop zone's opened past it when full. */
  get room(): string {
    return this.where;
  }

  /** Refused, the room having its MAX_PEERS: we call back now and then. */
  get isFull(): boolean {
    return this.refused;
  }

  /** The server's clock now, ms: the same for everyone in the room, to a few ms. */
  serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  /** The server's clock at a moment of ours (performance.now, ms): a frame's, say. */
  roomTime(local: number): number {
    return this.serverNow() - (performance.now() - local);
  }

  /** Players in the room, us included. */
  get players(): number {
    return Math.max(1, this.state.players.size);
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** In a public room, when the next load leaves (our clock, ms). */
  get nextLoadAt(): number {
    return nextLoad(Date.now() + this.clockOffset) - this.clockOffset;
  }

  /** Ready for the next jump, or no longer. When everyone is, it starts. */
  setReady(ready: boolean): void {
    if (ready === this.ready) return;
    this.ready = ready;
    // A public BASE site: no rotation, up there straight away.
    if (ready && this.isPublic && !this.onClock && this.shared) return this.started(this.shared.jump.start, this.shared, this.serverNow());
    this.sayHello();
    this.maybeStart();
    this.events.changed();
  }

  setName(name: string): void {
    this.name = cleanName(name);
    this.sayHello();
    this.events.changed();
  }

  /** What we would jump with: sent to the room while we lead. */
  setShared(shared: SharedSetup): void {
    this.shared = sharedPart(shared);
    if (this.state.isHost) this.sendSetup();
  }

  /** Leading: everyone goes now, ready or not. A public room goes by the clock only. */
  startNow(): void {
    if (this.isPublic || !this.state.isHost || !this.shared) return;
    const at = this.serverNow();
    const message: RoomMessage = { kind: 'start', start: this.shared.jump.start, setup: this.shared, at };
    this.mesh.broadcastRoom(message);
    this.started(message.start, this.shared, at);
  }

  /** Tells the others who we are now. */
  setHello(dz: DzId, gear: Gear): void {
    this.hello = { type: 'hello', dz, gear: { ...gear } };
    this.mesh.broadcastControl(JSON.stringify(this.hello));
  }

  /**
   * Sends `out` if it is time to: call every frame once `out` is filled. `at`:
   * when it is true, on the room's clock (ms): the others can tell how old it
   * is when it comes, and draw us where we are by then.
   */
  send(elapsed: number, at = this.serverNow()): void {
    this.sinceSent += elapsed;
    if (this.sinceSent < 1 / SEND_RATE) return;
    this.sinceSent = 0;
    this.out.t = at;
    this.mesh.broadcastState(encodeSnapshot(this.out));
  }

  /**
   * Draws the others: only those at our drop zone; `shown` false hides them
   * all. `self`: where we are, as we send it, to check how they see us.
   */
  update(f: Omit<RemoteFrame, 'now' | 'light'>, dz: DzId, shown = true, self?: Vec3): void {
    const now = performance.now();
    const frame: RemoteFrame = { ...f, now, light: this.light() };
    for (const { jumper, hello } of this.remotes.values()) {
      const heard = now - jumper.buffer.lastHeard < SILENT_MS;
      jumper.update(frame, shown && heard && hello !== null && hello.dz === dz);
    }
    for (const [id, { jumper }] of this.remotes) {
      if (jumper.exited) this.events.exited(this.state.players.get(id)?.name || '…');
    }
    if (f.roomTime !== undefined && self) this.check(f.roomTime, self);
    if (this.overlay && now - this.overlayAt > SEEN_EVERY_MS) {
      this.overlayAt = now;
      this.showOverlay();
    }
  }

  /**
   * What the reports of how the picture runs say of the room, since the last
   * one: how many measures, how far off the others draw us and how far apart
   * the views are (middle/worst, m), how far on we draw them (ms), the
   * quickest trip to the server (ms). Empty alone.
   */
  report(): string {
    const [offs, aparts, leads] = [this.offs, this.aparts, this.leads];
    const clocks = [...this.ticks.keys()].map((id) => this.clockAgainst(id)).filter((c) => c !== null);
    const skew = clocks.reduce((m, c) => (Math.abs(c.apart) > Math.abs(m) ? c.apart : m), 0);
    const skewTrip = clocks.reduce((m, c) => Math.max(m, c.trip), 0);
    this.offs = [];
    this.aparts = [];
    this.leads = [];
    if (this.remotes.size === 0) return '';
    const off = spread(offs);
    const apart = spread(aparts);
    const best = this.clockSamples.reduce((m, s) => Math.min(m, s.trip), Number.POSITIVE_INFINITY);
    const m = (x: number) => x.toFixed(2);
    return `peers=${this.remotes.size} n=${offs.length} off=${m(off.mid)}/${m(off.worst)} apart=${m(apart.mid)}/${m(apart.worst)} lead=${Math.round(spread(leads).mid)} trip=${Number.isFinite(best) ? Math.round(best) : -1} skew=${Math.round(skew)}/${Math.round(skewTrip)}`;
  }

  /** Where we are and where we draw the others, kept; and now and then, told to each of them. */
  private check(roomTime: number, self: Vec3): void {
    this.selfTrack.push(roomTime, self.x, self.y, self.z);
    // What came before our clock got there, now that it has; what is too old to look at, gone.
    if (this.pendingSeen.length > 0) {
      const waiting = this.pendingSeen;
      this.pendingSeen = [];
      for (const p of waiting) {
        if (p.told.at <= roomTime) this.onSeen(p.id, p.told);
        else if (p.told.at < roomTime + SEEN_EVERY_MS * 4) this.pendingSeen.push(p);
      }
    }
    if (roomTime - this.tickSentAt >= TICK_EVERY_MS) {
      this.tickSentAt = roomTime;
      const tick: Tick = { type: 'tick', a: this.serverNow() };
      this.mesh.broadcastControl(JSON.stringify(tick));
    }
    const tell = roomTime - this.seenSentAt >= SEEN_EVERY_MS;
    if (tell) this.seenSentAt = roomTime;
    for (const [id, { jumper }] of this.remotes) {
      const drawn = jumper.drawn;
      if (!drawn) continue;
      let track = this.seenTracks.get(id);
      if (!track) this.seenTracks.set(id, (track = new TimeTrack()));
      const p = drawn.pos;
      track.push(roomTime, p.x, p.y, p.z);
      if (jumper.lead > 0) this.leads.push(jumper.lead * 1000);
      if (!tell) continue;
      const seen: Seen = { type: 'seen', at: roomTime, self: [self.x, self.y, self.z], seen: [p.x, p.y, p.z] };
      this.mesh.sendControlTo(id, JSON.stringify(seen));
    }
  }

  /** Someone says where they drew us: against where we were then, and where we drew them. */
  private onSeen(id: string, told: Seen): void {
    // Their clock ahead of ours: looked at once ours gets there.
    if (told.at > this.selfTrack.newest) {
      if (this.pendingSeen.length < 32) this.pendingSeen.push({ id, told });
      return;
    }
    const us = this.selfTrack.at(told.at, vec3());
    if (!us) return;
    const them = this.seenTracks.get(id)?.at(told.at, vec3()) ?? null;
    const measured = compareSeen(told, us, them);
    this.offs.push(measured.off);
    if (measured.apart !== null) this.aparts.push(measured.apart);
    this.lastSeen.set(id, measured);
  }

  /** Their clock against ours, ms, from the quickest of the last answers; null before any. */
  private clockAgainst(id: string): { trip: number; apart: number } | null {
    const kept = this.ticks.get(id);
    if (!kept || kept.length === 0) return null;
    return kept.reduce((q, t) => (t.trip < q.trip ? t : q));
  }

  /** Someone compares clocks: answered at once; or their answer, kept. */
  private onTick(id: string, m: Tick | Tock): void {
    if (m.type === 'tick') {
      const tock: Tock = { type: 'tock', a: m.a, b: this.serverNow() };
      return this.mesh.sendControlTo(id, JSON.stringify(tock));
    }
    const measured = clockApart(m, this.serverNow());
    if (measured.trip < 0 || measured.trip > TIME_TRIP_MAX_MS) return;
    const kept = this.ticks.get(id) ?? [];
    kept.push(measured);
    if (kept.length > TICKS_KEPT) kept.shift();
    this.ticks.set(id, kept);
  }

  private showOverlay(): void {
    const overlay = this.overlay!;
    const best = this.clockSamples.reduce((m, s) => Math.min(m, s.trip), Number.POSITIVE_INFINITY);
    const lines = [`clock ±${Number.isFinite(best) ? Math.round(best / 2) : '?'} ms (trip ${Number.isFinite(best) ? Math.round(best) : '?'} ms)`];
    for (const [id, { jumper }] of this.remotes) {
      const seen = this.lastSeen.get(id);
      const name = (this.state.players.get(id)?.name || '…').replace(/[<>&"]/g, '');
      const off = seen ? `${seen.off.toFixed(2)} m` : '–';
      const apart = seen?.apart != null ? `${seen.apart.toFixed(2)} m` : '–';
      const clock = this.clockAgainst(id);
      const skew = clock ? `${clock.apart >= 0 ? '+' : ''}${Math.round(clock.apart)} ms (trip ${Math.round(clock.trip)})` : '–';
      lines.push(`${name}: clock ${skew}, sees us off by ${off}, views apart ${apart}, drawn on ${Math.round(jumper.lead * 1000)} ms`);
    }
    overlay.textContent = lines.join('\n');
  }

  /** Whether this player is still in the room and heard from. */
  has(id: string): boolean {
    return this.remotes.has(id);
  }

  /** Where a player is, if drawn here. */
  whereIs(id: string, out: THREE.Vector3): THREE.Vector3 | null {
    return this.remotes.get(id)?.jumper.where(out) ?? null;
  }

  /** The others drawn here, in the order they joined: who can be a target. */
  inSight(): { id: string; name: string; pos: THREE.Vector3 }[] {
    const seen: { id: string; name: string; pos: THREE.Vector3 }[] = [];
    for (const p of this.state.list) {
      const pos = this.remotes.get(p.id)?.jumper.where(new THREE.Vector3());
      if (pos) seen.push({ id: p.id, name: p.name || '…', pos });
    }
    return seen;
  }

  bodies(): OtherBody[] {
    const out: OtherBody[] = [];
    for (const [id, { jumper }] of this.remotes) {
      const pos = vec3();
      const vel = vec3();
      const body = jumper.body(pos, vel);
      if (body) out.push({ id, pos, vel, falling: body.falling });
    }
    return out;
  }

  members(): OtherJumper[] {
    const out: OtherJumper[] = [];
    for (const [id, { jumper, hello }] of this.remotes) {
      const snap = jumper.drawn;
      if (snap && hello) out.push({ id, name: this.nameOf(id), gear: hello.gear, snap });
    }
    return out;
  }

  /** A player's name as shown. */
  nameOf(id: string): string {
    return this.state.players.get(id)?.name || '…';
  }

  /** Tags over the others in sight, arrows at the edge for the rest. After the camera has moved. */
  drawMarkers(camera: THREE.PerspectiveCamera, targeted: string | null = null): void {
    const targets = this.targets;
    let n = 0;
    for (const [id, { jumper }] of this.remotes) {
      const target = (targets[n] ??= { id, name: '', pos: new THREE.Vector3(), color: '' });
      if (!jumper.where(target.pos)) continue;
      target.id = id;
      target.name = this.state.players.get(id)?.name || '…';
      target.color = jumper.color;
      n++;
    }
    targets.length = n;
    this.markers.update(camera, targets, targeted);
  }

  dispose(): void {
    window.clearInterval(this.loadTimer);
    window.clearTimeout(this.timeAsked);
    for (const t of this.timeBurst) window.clearTimeout(t);
    this.overlay?.remove();
    this.markers.dispose();
    this.mesh.dispose();
    for (const { jumper } of this.remotes.values()) jumper.dispose();
    this.remotes.clear();
  }

  private sayHello(): void {
    const self = this.state.self;
    if (self) {
      self.name = this.name;
      self.ready = this.ready;
    }
    this.mesh.broadcastRoom({ kind: 'hello', name: this.name, ready: this.ready } satisfies RoomMessage);
  }

  private sendSetup(): void {
    if (this.shared) this.mesh.broadcastRoom({ kind: 'setup', setup: this.shared } satisfies RoomMessage);
  }

  /** After someone came or went: if we lead now, the room jumps with our setup. */
  private leading(): void {
    if (this.state.isHost) this.sendSetup();
    this.maybeStart();
    this.events.changed();
  }

  /** Leading, with everyone ready: go. */
  private maybeStart(): void {
    if (!this.isPublic && this.state.isHost && this.state.allReady && performance.now() - this.startedAt > START_SETTLE_MS) this.startNow();
  }

  /**
   * A public room's load left: those aboard go, each on their own, the others
   * wait for the next. Only ever on to a later one: the clock set again a few
   * ms back does not make a load leave twice.
   */
  private rotate(): void {
    const next = nextLoad(this.serverNow());
    if (next <= this.loadSlot) return;
    this.loadSlot = next;
    // The one that just left, even if this page was asleep past others.
    if (this.ready && this.shared) return this.started(this.shared.jump.start, this.shared, next - LOAD_EVERY_MS);
    this.state.started();
    this.events.changed();
  }

  /** The server's time again in a while: soon at first, then now and again. */
  private askLater(): void {
    const wait = this.asks < TIME_FIRST_ASKS ? TIME_FIRST_MS : TIME_EVERY_MS;
    this.timeAsked = window.setTimeout(() => {
      this.asks++;
      this.mesh.askTime();
      this.askLater();
    }, wait);
  }

  /** The server's time, a few times now and then now and again: the quickest answer sets the clock. */
  private askTime(): void {
    for (const t of this.timeBurst) window.clearTimeout(t);
    this.timeBurst = Array.from({ length: TIME_BURST }, (_, i) => window.setTimeout(() => this.mesh.askTime(), i * TIME_BURST_GAP_MS));
  }

  private onTime(sent: number, now: number): void {
    const sample = clockSample(sent, now, Date.now());
    if (!Number.isFinite(sample.offset) || sample.trip < 0 || sample.trip > TIME_TRIP_MAX_MS) return;
    this.clockSamples.push(sample);
    if (this.clockSamples.length > TIME_KEPT) this.clockSamples.shift();
    this.clockOffset = bestOffset(this.clockSamples) ?? this.clockOffset;
  }

  private started(start: Start, shared: SharedSetup, at: number): void {
    this.startedAt = performance.now();
    this.seat = this.state.seat;
    this.state.started();
    this.ready = false;
    this.events.start(start, shared, at);
    this.sayHello();
    this.events.changed();
  }

  private onRoom(from: string, data: unknown): void {
    const m = readRoomMessage(data);
    if (!m) return;
    const fromHost = this.state.host?.id === from;
    if (m.kind === 'hello') {
      this.state.hello(from, m.name, m.ready);
      this.maybeStart();
      this.events.changed();
    } else if (m.kind === 'setup' && fromHost) {
      this.shared = m.setup;
      this.events.setup(m.setup);
    } else if (m.kind === 'start' && fromHost && !this.isPublic) {
      this.shared = m.setup;
      // From an older version, no time: about now.
      this.started(m.start, m.setup, m.at ?? this.serverNow());
    }
  }

  /** Someone in the room: one side's channel can hear before the other's says it is open. */
  private remote(id: string): { jumper: RemoteJumper; hello: Hello | null } {
    let remote = this.remotes.get(id);
    if (!remote) {
      remote = { jumper: new RemoteJumper(this.scene), hello: null };
      this.remotes.set(id, remote);
    }
    return remote;
  }

  private onControl(id: string, data: string): void {
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    const seen = readSeen(message);
    if (seen) return this.onSeen(id, seen);
    const tick = readTick(message);
    if (tick) return this.onTick(id, tick);
    const hello = readHello(message);
    if (!hello) return;
    const remote = this.remote(id);
    remote.hello = hello;
    remote.jumper.setGear(hello.gear, this.light());
  }
}

/** A hello from someone else, made safe to build a rig from; null if it is not one. */
export function readHello(m: unknown): Hello | null {
  if (typeof m !== 'object' || m === null) return null;
  const h = m as Partial<Hello>;
  const g = h.gear as Partial<Gear> | undefined;
  if (h.type !== 'hello' || typeof h.dz !== 'string' || typeof g !== 'object' || g === null) return null;
  const { kind, canopyAreaFt2, exitWeightKg, color } = g;
  if (typeof kind !== 'string' || !Object.hasOwn(CANOPY_SIZES, kind) || !isCanopyColor(color)) return null;
  if (typeof canopyAreaFt2 !== 'number' || typeof exitWeightKg !== 'number') return null;
  return {
    type: 'hello',
    dz: h.dz,
    gear: {
      ...(g as Gear),
      kind,
      color,
      // Someone on an older version has no smoke.
      smoke: isSmoke(g.smoke) ? g.smoke : 'none',
      // Nor a suit: a plain jumpsuit.
      suit: isSuitKind(g.suit) ? g.suit : 'jumpsuit',
      suitLevel: isSuitLevel(g.suitLevel) ? g.suitLevel : 1,
      // Nor colours of their own: the helmet and jumpsuit of old.
      helmetColor: isOutfitColor(g.helmetColor) ? g.helmetColor : DEFAULT_HELMET,
      suitColor: isOutfitColor(g.suitColor) ? g.suitColor : DEFAULT_SUIT,
      glowColor: isGlowColor(g.glowColor) ? g.glowColor : DEFAULT_GLOW,
      canopyAreaFt2: nearestSize(kind, canopyAreaFt2),
      exitWeightKg: validWeight(exitWeightKg),
    },
  };
}

/** The measures of `?net`, top left over the picture. */
function netOverlay(): HTMLElement {
  const el = document.createElement('pre');
  el.style.cssText =
    'position:fixed;top:8px;left:8px;z-index:50;margin:0;padding:6px 8px;font:12px/1.4 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.55);border-radius:4px;pointer-events:none;white-space:pre';
  document.body.appendChild(el);
  return el;
}
