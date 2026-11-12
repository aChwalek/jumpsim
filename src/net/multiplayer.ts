import type * as THREE from 'three';
import type { Lighting } from '../render/scene';
import { isCanopyColor } from '../render/canopyColors';
import { CANOPY_SIZES, nearestSize, validWeight, type Gear } from '../setup';
import type { DzId } from '../world/dzs';
import { Mesh } from './mesh';
import { ROOM_NAME } from './protocol';
import { RemoteJumper, type RemoteFrame } from './remote';
import { SNAPSHOT_BYTES, decodeSnapshot, emptySnapshot, encodeSnapshot, type Snapshot } from './snapshot';

/** Snapshots sent a second. */
const SEND_RATE = 15;
/** Not heard of for this long, ms: no longer drawn. */
const SILENT_MS = 3000;

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

  constructor(
    readonly room: string,
    private readonly scene: THREE.Scene,
    private readonly light: () => Lighting,
  ) {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    this.mesh = new Mesh(`${scheme}://${location.host}/signal/${room}`, '/turn', {
      open: (id) => {
        if (this.hello) this.mesh.sendControlTo(id, JSON.stringify(this.hello));
      },
      close: (id) => {
        this.remotes.get(id)?.jumper.dispose();
        this.remotes.delete(id);
      },
      state: (id, data) => {
        const s = decodeSnapshot(data, this.received);
        if (s) this.remote(id).jumper.buffer.push(s, performance.now());
      },
      control: (id, data) => this.onControl(id, data),
    });
  }

  /** Players in the room, us included, that we can see. */
  get players(): number {
    return 1 + this.mesh.connected;
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
  }

  dispose(): void {
    this.mesh.dispose();
    for (const { jumper } of this.remotes.values()) jumper.dispose();
    this.remotes.clear();
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
      canopyAreaFt2: nearestSize(kind, canopyAreaFt2),
      exitWeightKg: validWeight(exitWeightKg),
    },
  };
}
