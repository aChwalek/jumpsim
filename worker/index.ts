import { DurableObject } from 'cloudflare:workers';
import { MAX_PEERS, ROOM_NAME, type ClientMessage, type ServerMessage } from '../src/net/protocol';

/**
 * The static site, plus `/signal/<room>`: a WebSocket to the room's Durable
 * Object, which introduces the browsers to each other. Assets are served
 * before the Worker runs, so it only sees what is not a file.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const match = new URL(request.url).pathname.match(/^\/signal\/([^/]+)$/);
    if (!match) return new Response('Not found', { status: 404 });
    const room = match[1] ?? '';
    if (!ROOM_NAME.test(room)) return new Response('Bad room name', { status: 400 });
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request);
  },
} satisfies ExportedHandler<Env>;

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
    const id = crypto.randomUUID().slice(0, 8);
    // Tagged with its id, to find it again when a message is for it.
    this.ctx.acceptWebSocket(server, [id]);
    server.serializeAttachment(id);
    send(server, { type: 'welcome', id, peers: others.map(peerId) });
    for (const ws of others) send(ws, { type: 'join', id });
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
    if (message.type !== 'signal' || typeof message.to !== 'string') return;
    const to = this.ctx.getWebSockets(message.to)[0];
    if (to) send(to, { type: 'signal', from: peerId(ws), data: message.data });
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.left(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.left(ws);
  }

  private left(ws: WebSocket): void {
    const id = peerId(ws);
    for (const other of this.ctx.getWebSockets()) if (other !== ws) send(other, { type: 'leave', id });
    try {
      ws.close();
    } catch {
      // Already closed.
    }
  }
}

const peerId = (ws: WebSocket): string => ws.deserializeAttachment() as string;

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // Gone: its close will tell the others.
  }
}
