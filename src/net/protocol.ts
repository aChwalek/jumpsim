/**
 * What goes through the signalling server: what two browsers need to find
 * each other, and the few messages the whole room must hear (who is in it,
 * the setup, ready, go). The jumpers' states go peer to peer (WebRTC).
 * Shared with the Worker, so no DOM types here.
 */

/** A room's name in the URL: lower case letters, digits and dashes. */
export const ROOM_NAME = /^[a-z0-9-]{1,32}$/;
/** A drop zone's public room is named this and the DZ's id: anyone can find it, and see how many are in. */
export const PUBLIC_PREFIX = 'dz-';
/** Every peer connects to every other: past this, the uplink of each gets heavy. A drop zone's public room then opens another (shards.ts). */
export const MAX_PEERS = 8;
/** The server closes the socket with this code when the room has MAX_PEERS: not to call back at once. */
export const FULL_CLOSE = 4009;

/** Someone in the room, and when they came in (server clock, ms): the first one in leads. */
export interface Member {
  id: string;
  joined: number;
}

export type ServerMessage =
  /**
   * To the one who just came in: who they are, and who is already there.
   * `room`: the room they are in, which in a drop zone's public room may be
   * another one than asked, the one asked being full (not from an older server).
   */
  | { type: 'welcome'; you: Member; peers: Member[]; room?: string }
  /** Someone came in: they will call. */
  | { type: 'join'; member: Member }
  | { type: 'leave'; id: string }
  /** An offer, an answer or an ICE candidate, passed on from another peer. */
  | { type: 'signal'; from: string; data: unknown }
  /** Something for the whole room, from one of it. */
  | { type: 'broadcast'; from: string; data: unknown }
  /** The server's clock (ms), in answer to a `time` sent at `sent` (the asker's clock). */
  | { type: 'time'; sent: number; now: number };

export type ClientMessage =
  | { type: 'signal'; to: string; data: unknown }
  | { type: 'broadcast'; data: unknown }
  /** What time it is on the server: the loads leave by it, and their planes fly by it. */
  | { type: 'time'; sent: number };
