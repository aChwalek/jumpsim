import type { ClientMessage, Member, ServerMessage } from './protocol';

/**
 * How browsers find a way to each other through home routers: a STUN server
 * tells each one its public address. When two are both behind strict NATs,
 * a TURN server relays between them: the Worker hands out credentials for
 * Cloudflare's. Until it has answered, or if it cannot, STUN alone.
 */
const STUN_ONLY: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
/** TURN credentials last a day: new ones twice as often, for the peers still to come. */
const ICE_REFRESH_MS = 12 * 3600 * 1000;
/** Not waiting longer than this for them before connecting, ms. */
const ICE_TIMEOUT_MS = 4000;
/** Wait before calling the signalling server again after losing it, ms. */
const RECONNECT_MS = 3000;

type Signal = { sdp: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit | null };

export interface MeshEvents {
  /** In the room (again): who we are, who is there. */
  welcome(you: Member, peers: Member[]): void;
  /** Someone came into the room, or left it (whether or not we could reach them). */
  joined(member: Member): void;
  left(id: string): void;
  /** Lost the signalling server: out of the room until it comes back. */
  offline(): void;
  /** A message for the whole room, through the server. */
  room(from: string, data: unknown): void;
  /** A peer's channels are open: a good time to tell it who we are. */
  open(id: string): void;
  /** Gone, or never got through. */
  close(id: string): void;
  /** Often, unreliable: the jumpers' states. */
  state(id: string, data: ArrayBuffer): void;
  /** Rarely, reliable and in order: who someone is, what they fly. */
  control(id: string, data: string): void;
}

/**
 * Every peer in a room connected to every other, directly. The signalling
 * server only passes the first messages that let two browsers find each
 * other; the game then goes peer to peer, over two data channels:
 *  - `state`, unordered and never resent: a snapshot that comes late is
 *    worth less than the next one;
 *  - `control`, reliable and ordered, for the rest.
 */
export class Mesh {
  /** Our id in the room, once the server has given one. */
  id: string | null = null;
  private socket: WebSocket | null = null;
  private readonly peers = new Map<string, Peer>();
  private closed = false;
  private iceServers = STUN_ONLY;
  private readonly refresh: ReturnType<typeof setInterval>;

  /** `url`: the room's signalling WebSocket; `iceUrl`: where to ask for the ICE servers. */
  constructor(
    private readonly url: string,
    private readonly iceUrl: string,
    private readonly events: MeshEvents,
  ) {
    void this.loadIceServers().then(() => {
      if (!this.closed) this.connect();
    });
    this.refresh = setInterval(() => void this.loadIceServers(), ICE_REFRESH_MS);
  }

  /** The peers we can talk to now. */
  get connected(): number {
    let n = 0;
    for (const p of this.peers.values()) if (p.open) n++;
    return n;
  }

  broadcastState(data: ArrayBuffer): void {
    for (const p of this.peers.values()) if (p.state.readyState === 'open') p.state.send(data);
  }

  /** To the whole room through the server: rare messages everyone must get. */
  broadcastRoom(data: unknown): void {
    const message: ClientMessage = { type: 'broadcast', data };
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  broadcastControl(data: string): void {
    for (const p of this.peers.values()) this.sendControl(p, data);
  }

  sendControlTo(id: string, data: string): void {
    const p = this.peers.get(id);
    if (p) this.sendControl(p, data);
  }

  dispose(): void {
    this.closed = true;
    clearInterval(this.refresh);
    this.socket?.close();
    for (const id of [...this.peers.keys()]) this.drop(id);
  }

  private sendControl(p: Peer, data: string): void {
    if (p.control.readyState === 'open') p.control.send(data);
  }

  private async loadIceServers(): Promise<void> {
    try {
      const response = await fetch(this.iceUrl, { method: 'POST', signal: AbortSignal.timeout(ICE_TIMEOUT_MS) });
      if (!response.ok) return;
      const { iceServers } = (await response.json()) as { iceServers?: RTCIceServer[] };
      if (Array.isArray(iceServers) && iceServers.length > 0) this.iceServers = iceServers;
    } catch {
      // STUN alone, then.
    }
  }

  private connect(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onmessage = (e) => {
      if (typeof e.data === 'string') this.onServer(JSON.parse(e.data) as ServerMessage);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.id = null;
      // A new id when we come back: the others will be told we left, and call us again.
      for (const id of [...this.peers.keys()]) this.drop(id);
      this.events.offline();
      if (!this.closed) setTimeout(() => this.connect(), RECONNECT_MS);
    };
  }

  private onServer(m: ServerMessage): void {
    switch (m.type) {
      case 'welcome':
        this.id = m.you.id;
        this.events.welcome(m.you, m.peers);
        // The newcomer calls everyone already there: only one side ever offers.
        for (const p of m.peers) void this.call(p.id);
        break;
      case 'join':
        // They will call: nothing to do until their offer comes.
        this.events.joined(m.member);
        break;
      case 'leave':
        this.drop(m.id);
        this.events.left(m.id);
        break;
      case 'broadcast':
        this.events.room(m.from, m.data);
        break;
      case 'signal':
        void this.onSignal(m.from, m.data as Signal);
        break;
    }
  }

  private signal(to: string, data: Signal): void {
    const message: ClientMessage = { type: 'signal', to, data };
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private peer(id: string): Peer {
    let p = this.peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    // Negotiated: both sides make the same channels with the same ids, so
    // neither has to wait to be told of them.
    const state = pc.createDataChannel('state', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    const control = pc.createDataChannel('control', { negotiated: true, id: 1 });
    state.binaryType = 'arraybuffer';
    p = { pc, state, control, open: false, pending: [] };
    const peer = p;
    pc.onicecandidate = (e) => this.signal(id, { candidate: e.candidate?.toJSON() ?? null });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(id);
    };
    const opened = () => {
      if (peer.open || state.readyState !== 'open' || control.readyState !== 'open') return;
      peer.open = true;
      this.events.open(id);
    };
    state.onopen = control.onopen = opened;
    state.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) this.events.state(id, e.data);
    };
    control.onmessage = (e) => {
      if (typeof e.data === 'string') this.events.control(id, e.data);
    };
    this.peers.set(id, p);
    return p;
  }

  private async call(id: string): Promise<void> {
    const { pc } = this.peer(id);
    await pc.setLocalDescription(await pc.createOffer());
    if (pc.localDescription) this.signal(id, { sdp: pc.localDescription.toJSON() });
  }

  private async onSignal(from: string, data: Signal): Promise<void> {
    const p = this.peer(from);
    const { pc } = p;
    try {
      if ('sdp' in data) {
        await pc.setRemoteDescription(data.sdp);
        // Candidates that came before the description they belong to.
        for (const c of p.pending.splice(0)) await pc.addIceCandidate(c);
        if (data.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          if (pc.localDescription) this.signal(from, { sdp: pc.localDescription.toJSON() });
        }
      } else if (data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else p.pending.push(data.candidate);
      }
    } catch (error) {
      console.warn(`multiplayer: signalling with ${from} failed`, error);
    }
  }

  private drop(id: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    p.pc.close();
    this.events.close(id);
  }
}

interface Peer {
  pc: RTCPeerConnection;
  state: RTCDataChannel;
  control: RTCDataChannel;
  /** Both channels have opened. */
  open: boolean;
  /** ICE candidates waiting for the remote description. */
  pending: RTCIceCandidateInit[];
}
