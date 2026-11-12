import { DurableObject } from 'cloudflare:workers';
import { MAX_PEERS, ROOM_NAME, type ClientMessage, type Member, type ServerMessage } from '../src/net/protocol';

/** Secrets for the TURN relay (`wrangler secret put`); without them, STUN only. */
interface Secrets {
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

/**
 * The static site, plus:
 *  - `/signal/<room>`: a WebSocket to the room's Durable Object, which
 *    introduces the browsers to each other;
 *  - `/turn` (POST): short-lived credentials for Cloudflare's TURN relay.
 * Assets are served before the Worker runs, so it only sees what is not a file.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/turn') return iceServers(request, env as Env & Secrets);
    const match = url.pathname.match(/^\/signal\/([^/]+)$/);
    if (!match) return new Response('Not found', { status: 404 });
    const room = match[1] ?? '';
    if (!ROOM_NAME.test(room)) return new Response('Bad room name', { status: 400 });
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

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/**
 * One room: relays offers, answers and ICE candidates between its peers, and
 * tells them who comes and goes. Uses the hibernation API: between messages
 * the object sleeps and costs nothing, the sockets staying open.
 */
export class Room extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
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
