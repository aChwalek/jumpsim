/**
 * A drop zone's public room holds MAX_PEERS at most: past that, the server
 * seats whoever comes in another one of the same drop zone, `dz-pujaut-2`,
 * `dz-pujaut-3`… (its shards). The first keeps the plain name. Shared with the
 * Worker: no DOM, no list of the drop zones.
 */
import { MAX_PEERS, PUBLIC_PREFIX } from './protocol';

/** The most shards a drop zone's public room may have. */
export const MAX_SHARD = 999;
/** Rooms tried at most for one coming in, before telling them it is full. */
export const SEAT_TRIES = 6;

/** `dz-<drop zone>`, then `-2` to `-999` past the first: no `-1`, no `-02`, those are other names. */
const SHARD = new RegExp(`^(${PUBLIC_PREFIX}[a-z0-9-]+?)(?:-([2-9]|[1-9][0-9]{1,2}))?$`);

/** One of a drop zone's public rooms: `base` its plain name (the first one's), `n` which of them, from 1. */
export interface Shard {
  base: string;
  n: number;
}

/** Which public room a room's name is; null for a room of one's own. */
export function publicShard(room: string): Shard | null {
  const m = SHARD.exec(room);
  if (!m?.[1]) return null;
  return { base: m[1], n: m[2] ? Number(m[2]) : 1 };
}

export const shardName = (base: string, n: number): string => (n === 1 ? base : `${base}-${n}`);

/** What the lobby knows of a shard: how many were in it when it last said. */
export interface ShardCount {
  n: number;
  players: number;
}

/**
 * The shards to try, in order, for someone coming in who asked for `want`
 * (1 from the menu; another from a friend's link, or to come back after
 * losing the server): `want` first if someone is in it, even thought full
 * (all of a room are thought still in it a minute after a deploy dropped them,
 * and come back to it; one full answers at once); then the others with people
 * and room, the fullest first, to be with the most; then empty ones, `want`
 * first, then the lowest.
 */
export function seatOrder(shards: readonly ShardCount[], want: number): number[] {
  const count = new Map(shards.map((s) => [s.n, s.players]));
  const players = (n: number): number => count.get(n) ?? 0;
  const order = players(want) > 0 ? [want] : [];
  const open = shards
    .filter((s) => s.players > 0 && s.players < MAX_PEERS && s.n !== want)
    .sort((a, b) => b.players - a.players || a.n - b.n)
    .map((s) => s.n);
  // At least one empty one: what we know may be old, the open ones full by now.
  order.push(...open.slice(0, SEAT_TRIES - 1 - order.length));
  if (players(want) === 0 && want <= MAX_SHARD) order.push(want);
  for (let n = 1; n <= MAX_SHARD && order.length < SEAT_TRIES; n++) if (players(n) === 0 && n !== want) order.push(n);
  return order.slice(0, SEAT_TRIES);
}
