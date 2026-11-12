/**
 * What goes through the signalling server: only what two browsers need to
 * find each other. Once they have, they talk directly (WebRTC) and the server
 * hears nothing more of the game. Shared with the Worker, so no DOM types here.
 */

/** A room's name in the URL: lower case letters, digits and dashes. */
export const ROOM_NAME = /^[a-z0-9-]{1,32}$/;
/** Every peer connects to every other: past this, the uplink of each gets heavy. */
export const MAX_PEERS = 8;

export type ServerMessage =
  /** To the one who just came in: its own id, and who is already there. */
  | { type: 'welcome'; id: string; peers: string[] }
  /** Someone came in: they will call. */
  | { type: 'join'; id: string }
  | { type: 'leave'; id: string }
  /** An offer, an answer or an ICE candidate, passed on from another peer. */
  | { type: 'signal'; from: string; data: unknown };

export type ClientMessage = { type: 'signal'; to: string; data: unknown };
