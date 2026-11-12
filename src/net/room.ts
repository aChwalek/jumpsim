import { STARTS, validSetup, type Setup, type Start } from '../setup';
import { DZS, type DzId } from '../world/dzs';
import { PUBLIC_PREFIX, type Member } from './protocol';

/** A drop zone's public room: the one anyone there can join. */
export const publicRoom = (dz: DzId): string => `${PUBLIC_PREFIX}${dz}`;

/** The drop zone a room is the public room of; null for a room of one's own. */
export function publicDz(room: string): DzId | null {
  return DZS.find((d) => publicRoom(d.id) === room)?.id ?? null;
}

/**
 * A public room does not wait for anyone: a load leaves every this often, ms,
 * with whoever is aboard. On the server's clock, so the same for all.
 */
export const LOAD_EVERY_MS = 30_000;

/** When the next load leaves, after `now` (server clock, ms). */
export const nextLoad = (now: number): number => (Math.floor(now / LOAD_EVERY_MS) + 1) * LOAD_EVERY_MS;

/** What everyone in a room jumps with: all of the setup but each one's own gear, and the bots of a jump alone. */
export type SharedSetup = Omit<Setup, 'gear' | 'bots'>;

export const sharedPart = (s: SharedSetup): SharedSetup => ({ dz: s.dz, hour: s.hour, weather: { ...s.weather }, jump: { ...s.jump } });

/** Whether two shared setups are the same jump. */
export function sameShared(a: SharedSetup, b: SharedSetup): boolean {
  const same = <T extends object>(x: T, y: T): boolean => {
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    return [...keys].every((k) => (x as Record<string, unknown>)[k] === (y as Record<string, unknown>)[k]);
  };
  return a.dz === b.dz && a.hour === b.hour && same(a.weather, b.weather) && same(a.jump, b.jump);
}

/** Longest name shown. */
export const NAME_MAX = 20;

/** What goes to the whole room through the signalling server. */
export type RoomMessage =
  /** Who someone is, and whether they are ready: on coming in, and on every change. */
  | { kind: 'hello'; name: string; ready: boolean }
  /** From whoever leads: what everyone jumps with. */
  | { kind: 'setup'; setup: SharedSetup }
  /** From whoever leads: everyone goes now. */
  | { kind: 'start'; start: Start; setup: SharedSetup };

/** A room message from someone else, made safe; null if it is not one. */
export function readRoomMessage(m: unknown): RoomMessage | null {
  if (typeof m !== 'object' || m === null) return null;
  const r = m as Record<string, unknown>;
  switch (r.kind) {
    case 'hello':
      if (typeof r.name !== 'string' || typeof r.ready !== 'boolean') return null;
      return { kind: 'hello', name: cleanName(r.name), ready: r.ready };
    case 'setup':
      return { kind: 'setup', setup: sharedPart(validSetup(r.setup)) };
    case 'start':
      if (!STARTS.includes(r.start as Start)) return null;
      return { kind: 'start', start: r.start as Start, setup: sharedPart(validSetup(r.setup)) };
    default:
      return null;
  }
}

/** A name as shown: one line, not too long. */
export const cleanName = (name: string): string => name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

export interface Player {
  id: string;
  joined: number;
  /** Empty until they have said. */
  name: string;
  ready: boolean;
}

/**
 * Who is in the room, who leads and who is ready, as this browser knows it.
 * The server says who comes and goes, in the order they came; the first one
 * in leads, and the next one takes over when they go.
 */
export class RoomState {
  readonly players = new Map<string, Player>();
  selfId: string | null = null;

  /** We are in: `you` and those already there. Whoever we knew before is forgotten. */
  welcome(you: Member, peers: Member[], name: string, ready: boolean): void {
    this.players.clear();
    this.selfId = you.id;
    this.players.set(you.id, { ...you, name, ready });
    for (const p of peers) this.join(p);
  }

  join(m: Member): void {
    if (!this.players.has(m.id)) this.players.set(m.id, { ...m, name: '', ready: false });
  }

  leave(id: string): void {
    this.players.delete(id);
  }

  hello(id: string, name: string, ready: boolean): void {
    const p = this.players.get(id);
    if (!p) return;
    p.name = name;
    p.ready = ready;
  }

  get self(): Player | null {
    return this.selfId === null ? null : (this.players.get(this.selfId) ?? null);
  }

  /** Whoever leads: the first one in. */
  get host(): Player | null {
    let first: Player | null = null;
    for (const p of this.players.values()) {
      if (!first || p.joined < first.joined || (p.joined === first.joined && p.id < first.id)) first = p;
    }
    return first;
  }

  get isHost(): boolean {
    return this.selfId !== null && this.host?.id === this.selfId;
  }

  /** In the order they came in. */
  get list(): Player[] {
    return [...this.players.values()].sort((a, b) => a.joined - b.joined || (a.id < b.id ? -1 : 1));
  }

  get allReady(): boolean {
    return this.players.size > 0 && [...this.players.values()].every((p) => p.ready);
  }

  get readyCount(): number {
    return [...this.players.values()].filter((p) => p.ready).length;
  }

  /** Everyone goes: nobody is ready for the next one yet. */
  started(): void {
    for (const p of this.players.values()) p.ready = false;
  }
}
