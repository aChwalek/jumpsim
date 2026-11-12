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
/** Every peer connects to every other: past this, the uplink of each gets heavy. */
export const MAX_PEERS = 8;

/** Someone in the room, and when they came in (server clock, ms): the first one in leads. */
export interface Member {
  id: string;
  joined: number;
}

export type ServerMessage =
  /** To the one who just came in: who they are, and who is already there. */
  | { type: 'welcome'; you: Member; peers: Member[] }
  /** Someone came in: they will call. */
  | { type: 'join'; member: Member }
  | { type: 'leave'; id: string }
  /** An offer, an answer or an ICE candidate, passed on from another peer. */
  | { type: 'signal'; from: string; data: unknown }
  /** Something for the whole room, from one of it. */
  | { type: 'broadcast'; from: string; data: unknown };

export type ClientMessage = { type: 'signal'; to: string; data: unknown } | { type: 'broadcast'; data: unknown };
