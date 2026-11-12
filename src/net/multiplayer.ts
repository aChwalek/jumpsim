import { isSmoke } from '../render/smoke';
import * as THREE from 'three';
import type { Lighting } from '../render/scene';
import { isCanopyColor } from '../render/canopyColors';
import { CANOPY_SIZES, nearestSize, validWeight, type Gear, type Start } from '../setup';
import type { DzId } from '../world/dzs';
import { Markers, type MarkerTarget } from './markers';
import { Mesh } from './mesh';
import { ROOM_NAME } from './protocol';
import { RemoteJumper, type RemoteFrame } from './remote';
import { RoomState, cleanName, readRoomMessage, sharedPart, type RoomMessage, type SharedSetup } from './room';
import { SNAPSHOT_BYTES, decodeSnapshot, emptySnapshot, encodeSnapshot, type Snapshot } from './snapshot';

/** Snapshots sent a second. */
const SEND_RATE = 15;
/** Not heard of for this long, ms: no longer drawn. */
const SILENT_MS = 3000;
/** After a start, not another on its own for this long, ms: the ready flags have to settle. */
const START_SETTLE_MS = 3000;

/** What the room tells the sim. */
export interface RoomEvents {
  /** What everyone jumps with, from whoever leads. Not called on the one who leads. */
  setup(shared: SharedSetup): void;
  /** Everyone goes, now. */
  start(start: Start, shared: SharedSetup): void;
  /** Who is in, who leads, who is ready: something changed. */
  changed(): void;
  /** Someone at our drop zone left their plane. */
  exited(name: string): void;
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

/** The address to give the others for a room. */
export function roomLink(room: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', room);
  return url.toString();
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
  private readonly sendBuffer = new ArrayBuffer(SNAPSHOT_BYTES);
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

  constructor(
    readonly room: string,
    private readonly scene: THREE.Scene,
    private readonly light: () => Lighting,
    name: string,
    private readonly events: RoomEvents,
  ) {
    this.name = cleanName(name);
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    this.mesh = new Mesh(`${scheme}://${location.host}/signal/${room}`, '/turn', {
      welcome: (you, peers) => {
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
      offline: () => {
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
        this.markers.remove(id);
      },
      state: (id, data) => {
        const s = decodeSnapshot(data, this.received);
        if (s) this.remote(id).jumper.buffer.push(s, performance.now());
      },
      control: (id, data) => this.onControl(id, data),
    });
  }

  /** Players in the room, us included. */
  get players(): number {
    return Math.max(1, this.state.players.size);
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Ready for the next jump, or no longer. When everyone is, it starts. */
  setReady(ready: boolean): void {
    if (ready === this.ready) return;
    this.ready = ready;
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

  /** Leading: everyone goes now, ready or not. */
  startNow(): void {
    if (!this.state.isHost || !this.shared) return;
    const message: RoomMessage = { kind: 'start', start: this.shared.jump.start, setup: this.shared };
    this.mesh.broadcastRoom(message);
    this.started(message.start, this.shared);
  }

  /** Tells the others who we are now. */
  setHello(dz: DzId, gear: Gear): void {
    this.hello = { type: 'hello', dz, gear: { ...gear } };
    this.mesh.broadcastControl(JSON.stringify(this.hello));
  }

  /** Sends `out` if it is time to: call every frame once `out` is filled. */
  send(elapsed: number): void {
    this.sinceSent += elapsed;
    if (this.sinceSent < 1 / SEND_RATE) return;
    this.sinceSent = 0;
    this.out.t = performance.now();
    this.mesh.broadcastState(encodeSnapshot(this.out, this.sendBuffer));
  }

  /** Draws the others: only those at our drop zone. */
  update(f: Omit<RemoteFrame, 'now' | 'light'>, dz: DzId): void {
    const now = performance.now();
    const frame: RemoteFrame = { ...f, now, light: this.light() };
    for (const { jumper, hello } of this.remotes.values()) {
      const heard = now - jumper.buffer.lastHeard < SILENT_MS;
      jumper.update(frame, heard && hello !== null && hello.dz === dz);
    }
    for (const [id, { jumper }] of this.remotes) {
      if (jumper.exited) this.events.exited(this.state.players.get(id)?.name || '…');
    }
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
    if (this.state.isHost && this.state.allReady && performance.now() - this.startedAt > START_SETTLE_MS) this.startNow();
  }

  private started(start: Start, shared: SharedSetup): void {
    this.startedAt = performance.now();
    this.state.started();
    this.ready = false;
    this.events.start(start, shared);
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
    } else if (m.kind === 'start' && fromHost) {
      this.shared = m.setup;
      this.started(m.start, m.setup);
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
      canopyAreaFt2: nearestSize(kind, canopyAreaFt2),
      exitWeightKg: validWeight(exitWeightKg),
    },
  };
}
