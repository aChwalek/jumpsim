import { DurableObject } from 'cloudflare:workers';
import { MAX_PEERS, PUBLIC_PREFIX, ROOM_NAME, type ClientMessage, type Member, type ServerMessage } from '../src/net/protocol';
import { PERF_BLOBS, PERF_DOUBLES, PERF_MAX_BYTES } from '../src/net/perfSchema';
import {
  BOARD_DZS,
  BOARD_TOP,
  parseSubmission,
  submissionPoints,
  type Board,
  type BoardDz,
  type BoardRow,
  type Place,
  type ScoreSubmission,
  type Standing,
} from '../src/net/scores';
import { createAuth, googleOffered, sessionUser, type AuthSecrets } from './auth';

/** Secrets for the TURN relay (`wrangler secret put`); without them, STUN only. */
interface Secrets {
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

/**
 * The static site, plus:
 *  - `/signal/<room>`: a WebSocket to the room's Durable Object, which
 *    introduces the browsers to each other;
 *  - `/players/<room>` (GET): how many are in a drop zone's public room;
 *  - `/turn` (POST): short-lived credentials for Cloudflare's TURN relay;
 *  - `/perf` (POST): how the picture runs in a browser, to Analytics Engine;
 *  - `/api/auth/*`: accounts (Better Auth, see auth.ts); `/api/providers`
 *    (GET): the ways to sign in offered;
 *  - `/scores` (POST): a scored landing for the accuracy leaderboard, from
 *    the account signed in; `/scores/<dz>` (GET): that drop zone's board;
 *    `/scores/me` (GET): the account's place at each.
 * Assets are served before the Worker runs, so it only sees what is not a file.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/turn') return iceServers(request, env as Env & Secrets);
    if (url.pathname === '/perf') return perf(request, env);
    if (url.pathname.startsWith('/api/auth/')) return createAuth(env as Env & AuthSecrets, request).handler(request);
    if (url.pathname === '/api/providers') return json({ google: googleOffered(env as AuthSecrets) });
    if (url.pathname === '/scores' || url.pathname.startsWith('/scores/')) return scores(request, url, env as Env & AuthSecrets);
    const match = url.pathname.match(/^\/(signal|players)\/([^/]+)$/);
    if (!match) return new Response('Not found', { status: 404 });
    const room = match[2] ?? '';
    if (!ROOM_NAME.test(room)) return new Response('Bad room name', { status: 400 });
    // Only the public rooms say who is in: the others are for those given the link.
    const counting = match[1] === 'players';
    if (counting && (request.method !== 'GET' || !room.startsWith(PUBLIC_PREFIX))) return new Response('Not found', { status: 404 });
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** How long TURN credentials last, s: longer than anyone stays in a room. */
const TURN_TTL = 24 * 3600;

/**
 * The ICE servers a browser should use: Cloudflare's STUN, and its TURN with
 * credentials made for this request, so that the key never leaves here.
 */
async function iceServers(request: Request, env: Secrets): Promise<Response> {
  if (request.method !== 'POST') return new Response('Expected POST', { status: 405 });
  // Browsers say where a POST comes from: not for other sites to spend our relay.
  const origin = request.headers.get('Origin');
  if (!origin || new URL(origin).host !== request.headers.get('Host')) return new Response('Forbidden', { status: 403 });
  const stunOnly = { iceServers: [{ urls: [STUN] }] };
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json(stunOnly);
  const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TURN_TTL }),
  });
  if (!response.ok) {
    console.error(`TURN credentials: ${response.status} ${await response.text()}`);
    return json(stunOnly);
  }
  const { iceServers } = (await response.json()) as { iceServers: { urls: string[] | string; username?: string; credential?: string }[] };
  // Browsers block port 53: those would only time out.
  for (const server of iceServers) {
    if (Array.isArray(server.urls)) server.urls = server.urls.filter((u) => !/:53(\?|$)/.test(u));
  }
  return json({ iceServers });
}

const STUN = 'stun:stun.cloudflare.com:3478';

/** Whether a POST comes from a page of this site: browsers say where it comes from. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.get('Host');
  } catch {
    return false;
  }
}

/**
 * One report of how the picture runs (see perfSchema), written as one data
 * point: strings and numbers in their fixed order, the visit's id as the index.
 */
async function perf(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return new Response('Expected POST', { status: 405 });
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
  const text = await request.text();
  if (text.length > PERF_MAX_BYTES) return new Response('Too large', { status: 413 });
  let report: Record<string, unknown>;
  try {
    report = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  if (typeof report !== 'object' || report === null) return new Response('Bad report', { status: 400 });
  const blob = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 256) : '');
  const double = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  // Not bound when run on its own (wrangler dev without it): nothing to write to.
  env.PERF?.writeDataPoint({
    indexes: [blob(report.session).slice(0, 32)],
    blobs: PERF_BLOBS.map((k) => blob(report[k])),
    doubles: PERF_DOUBLES.map((k) => double(report[k])),
  });
  return new Response(null, { status: 204 });
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** The longest body taken by /scores: a score is a few hundred bytes. */
const SCORES_MAX_BYTES = 2048;

/**
 * The accuracy leaderboard: one Durable Object holds every drop zone's board.
 * Who sends a score, or asks, is the account signed in, from its session.
 */
async function scores(request: Request, url: URL, env: Env & AuthSecrets): Promise<Response> {
  const board = env.LEADERBOARD.get(env.LEADERBOARD.idFromName('accuracy'));
  if (request.method === 'GET') {
    const user = await sessionUser(env, request);
    if (url.pathname === '/scores/me') return json(user ? await board.places(user.id) : []);
    const dz = url.pathname.slice('/scores/'.length);
    if (!BOARD_DZS.includes(dz as BoardDz)) return new Response('Not found', { status: 404 });
    return json(await board.board(dz as BoardDz, user?.id ?? null));
  }
  if (request.method !== 'POST' || url.pathname !== '/scores') return new Response('Expected GET, or POST to /scores', { status: 405 });
  // Not for other sites' pages to post scores from their visitors' browsers.
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
  const user = await sessionUser(env, request);
  if (!user) return new Response('Not signed in', { status: 401 });
  const text = await request.text();
  if (text.length > SCORES_MAX_BYTES) return new Response('Too large', { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const submission = parseSubmission(body);
  if (!submission) return new Response('Bad score', { status: 400 });
  const standing = await board.submit(user.id, user.name, submission, Date.now());
  return standing ? json(standing) : new Response('Too soon', { status: 429 });
}

/**
 * One room: relays offers, answers and ICE candidates between its peers, and
 * tells them who comes and goes. Uses the hibernation API: between messages
 * the object sleeps and costs nothing, the sockets staying open.
 */
export class Room extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/players/')) return json({ players: this.ctx.getWebSockets().length });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const others = this.ctx.getWebSockets();
    if (others.length >= MAX_PEERS) return new Response('Room full', { status: 403 });
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    const you: Member = { id: crypto.randomUUID().slice(0, 8), joined: Date.now() };
    // Tagged with its id, to find it again when a message is for it.
    this.ctx.acceptWebSocket(server, [you.id]);
    server.serializeAttachment(you);
    send(server, { type: 'welcome', you, peers: others.map(member) });
    for (const ws of others) send(ws, { type: 'join', member: you });
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 16_000) return;
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    const from = member(ws).id;
    if (message.type === 'broadcast') {
      for (const other of this.ctx.getWebSockets()) if (other !== ws) send(other, { type: 'broadcast', from, data: message.data });
    } else if (message.type === 'signal' && typeof message.to === 'string') {
      const to = this.ctx.getWebSockets(message.to)[0];
      if (to) send(to, { type: 'signal', from, data: message.data });
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.left(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.left(ws);
  }

  private left(ws: WebSocket): void {
    const { id } = member(ws);
    for (const other of this.ctx.getWebSockets()) if (other !== ws) send(other, { type: 'leave', id });
    try {
      ws.close();
    } catch {
      // Already closed.
    }
  }
}

const member = (ws: WebSocket): Member => ws.deserializeAttachment() as Member;

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // Gone: its close will tell the others.
  }
}

/** Two scores from one player closer together than this are not two landings, ms. */
const SCORE_GAP_MS = 5_000;

/** A player's best at a drop zone, with their name, as SQLite has it. */
type BestRow = {
  name: string;
  player: string;
  points: number;
  distance: number;
  start: string;
  kind: string;
  area: number;
  wind: number;
  time: number;
};

const BEST_COLUMNS = 'p.name, b.player, b.points, b.distance, b.start, b.kind, b.area, b.wind, b.time';

/**
 * Every drop zone's accuracy board, in SQLite: each player's best landing at
 * each, and their name kept apart, so that a new name shows on all of them.
 * Ties go to whoever did it first.
 */
export class Leaderboard extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      last INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS best (
      dz TEXT NOT NULL,
      player TEXT NOT NULL,
      points INTEGER NOT NULL,
      distance REAL NOT NULL,
      start TEXT NOT NULL,
      kind TEXT NOT NULL,
      area INTEGER NOT NULL,
      wind INTEGER NOT NULL,
      time INTEGER NOT NULL,
      PRIMARY KEY (dz, player)
    )`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS best_rank ON best (dz, points DESC, time)');
  }

  /** Takes a scored landing from an account (its id and name); null if it sent one a moment ago. */
  submit(player: string, name: string, s: ScoreSubmission, now: number): Standing | null {
    const last = this.sql.exec<{ last: number }>('SELECT last FROM players WHERE id = ?', player).toArray()[0]?.last;
    if (last !== undefined && now - last < SCORE_GAP_MS) return null;
    this.sql.exec(
      'INSERT INTO players (id, name, last) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, last = excluded.last',
      player,
      name,
      now,
    );
    const points = submissionPoints(s);
    const before = this.sql.exec<{ points: number }>('SELECT points FROM best WHERE dz = ? AND player = ?', s.dz, player).toArray()[0]?.points;
    // Only better: equalling it leaves the first one, and its date.
    const improved = before === undefined || points > before;
    if (improved) {
      this.sql.exec(
        'INSERT OR REPLACE INTO best (dz, player, points, distance, start, kind, area, wind, time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        s.dz,
        player,
        points,
        s.distance,
        s.start,
        s.canopy.kind,
        s.canopy.areaFt2,
        s.windKmh,
        now,
      );
    }
    const best = before === undefined || improved ? points : before;
    return { rank: this.rankOf(s.dz, best), players: this.count(s.dz), points: best, improved };
  }

  /** A drop zone's board, as seen by `player` (null: by anyone). */
  board(dz: BoardDz, player: string | null): Board {
    const rows = this.sql
      .exec<BestRow>(`SELECT ${BEST_COLUMNS} FROM best b JOIN players p ON p.id = b.player WHERE b.dz = ? ORDER BY b.points DESC, b.time ASC LIMIT ?`, dz, BOARD_TOP)
      .toArray();
    const top: BoardRow[] = [];
    rows.forEach((r, i) => {
      const above = top[i - 1];
      top.push(boardRow(r, above && above.points === r.points ? above.rank : i + 1, r.player === player));
    });
    let you: BoardRow | null = null;
    if (player && !top.some((r) => r.you)) {
      const mine = this.sql
        .exec<BestRow>(`SELECT ${BEST_COLUMNS} FROM best b JOIN players p ON p.id = b.player WHERE b.dz = ? AND b.player = ?`, dz, player)
        .toArray()[0];
      if (mine) you = boardRow(mine, this.rankOf(dz, mine.points), true);
    }
    return { dz, players: this.count(dz), top, you };
  }

  /** A player's new name, on every board they are on. */
  rename(player: string, name: string): void {
    this.sql.exec('UPDATE players SET name = ? WHERE id = ?', name, player);
  }

  /** The player's place at each drop zone where they have a score, best first. */
  places(player: string): Place[] {
    return this.sql
      .exec<{ dz: string; points: number }>('SELECT dz, points FROM best WHERE player = ? ORDER BY points DESC', player)
      .toArray()
      .map(({ dz, points }) => ({ dz: dz as BoardDz, rank: this.rankOf(dz, points), players: this.count(dz), points }));
  }

  /**
   * An anonymous account's scores to the account it became (signed in with
   * Google): at each drop zone the better of the two is kept, under `name`.
   */
  moveScores(from: string, to: string, name: string): void {
    if (from === to) return;
    // Where the anonymous one did better (or as well, first), the other's goes; then the anonymous one's where it did not.
    this.sql.exec(
      `DELETE FROM best WHERE player = ? AND dz IN (
         SELECT a.dz FROM best a JOIN best b ON a.dz = b.dz AND b.player = ?
         WHERE a.player = ? AND (b.points > a.points OR (b.points = a.points AND b.time < a.time)))`,
      to,
      from,
      to,
    );
    this.sql.exec('DELETE FROM best WHERE player = ? AND dz IN (SELECT dz FROM best WHERE player = ?)', from, to);
    this.sql.exec('UPDATE best SET player = ? WHERE player = ?', to, from);
    const last = this.sql.exec<{ last: number }>('SELECT MAX(last) AS last FROM players WHERE id IN (?, ?)', from, to).one().last ?? 0;
    this.sql.exec('DELETE FROM players WHERE id = ?', from);
    if (this.sql.exec('SELECT 1 FROM best WHERE player = ? LIMIT 1', to).toArray().length) {
      this.sql.exec('INSERT INTO players (id, name, last) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name', to, name, last);
    }
  }

  /** Equal points, equal rank: one more than those strictly better. */
  private rankOf(dz: string, points: number): number {
    return 1 + this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM best WHERE dz = ? AND points > ?', dz, points).one().n;
  }

  private count(dz: string): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM best WHERE dz = ?', dz).one().n;
  }
}

/** A row of a board as sent: without the player's id, which is theirs alone. */
function boardRow(r: BestRow, rank: number, you: boolean): BoardRow {
  return {
    rank,
    name: r.name,
    points: r.points,
    distance: r.distance,
    start: r.start as BoardRow['start'],
    canopy: { kind: r.kind as BoardRow['canopy']['kind'], areaFt2: r.area },
    windKmh: r.wind,
    time: r.time,
    you,
  };
}
