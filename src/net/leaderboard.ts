// The accuracy leaderboard from the game's side: sending a scored landing,
// reading a drop zone's board, the player's places. Who sends is the account
// signed in (see account.ts), from its session's cookie. Without a connection
// (or without `npm run dev:signal` in development) nothing is sent, and the
// menu says the board cannot be reached.

import type { Board, BoardDz, Place, ScoreSubmission, Standing } from './scores';

export { madeUpName } from './scores';

/** Sends a scored landing; where it leaves the player on that board, or null if it could not be sent. */
export async function sendScore(score: ScoreSubmission): Promise<Standing | null> {
  try {
    const response = await fetch('/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(score),
    });
    if (!response.ok) return null;
    const s = (await response.json()) as Partial<Standing>;
    return typeof s.rank === 'number' && typeof s.players === 'number' && typeof s.points === 'number'
      ? { rank: s.rank, players: s.players, points: s.points, improved: !!s.improved }
      : null;
  } catch {
    return null;
  }
}

/** A drop zone's board as this player sees it, or null if the server could not be reached. */
export async function loadBoard(dz: BoardDz): Promise<Board | null> {
  try {
    const response = await fetch(`/scores/${dz}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const board = (await response.json()) as Board;
    return Array.isArray(board.top) && typeof board.players === 'number' ? board : null;
  } catch {
    return null;
  }
}

/** The player's place at each drop zone where they have a score, best first; null if the server could not be reached. */
export async function loadPlaces(): Promise<Place[] | null> {
  try {
    const response = await fetch('/scores/me', { cache: 'no-store' });
    if (!response.ok) return null;
    const places = (await response.json()) as Place[];
    return Array.isArray(places) ? places : null;
  } catch {
    return null;
  }
}
