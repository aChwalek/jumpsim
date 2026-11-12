import type { ClientMessage, ServerMessage } from './protocol';

/**
 * How browsers find a way to each other through home routers: a STUN server
 * tells each one its public address. Two peers behind strict NATs would also
 * need a TURN relay, which this does not have yet.
 */
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
/** Wait before calling the signalling server again after losing it, ms. */
const RECONNECT_MS = 3000;

type Signal = { sdp: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit | null };

export interface MeshEvents {
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

  constructor(
    private readonly url: string,
    private readonly events: MeshEvents,
  ) {
    this.connect();
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

  broadcastControl(data: string): void {
    for (const p of this.peers.values()) this.sendControl(p, data);
  }

  sendControlTo(id: string, data: string): void {
    const p = this.peers.get(id);
    if (p) this.sendControl(p, data);
  }

  dispose(): void {
    this.closed = true;
    this.socket?.close();
    for (const id of [...this.peers.keys()]) this.drop(id);
  }

  private sendControl(p: Peer, data: string): void {
    if (p.control.readyState === 'open') p.control.send(data);
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
      if (!this.closed) setTimeout(() => this.connect(), RECONNECT_MS);
    };
  }

  private onServer(m: ServerMessage): void {
    switch (m.type) {
      case 'welcome':
        this.id = m.id;
        // The newcomer calls everyone already there: only one side ever offers.
        for (const id of m.peers) void this.call(id);
        break;
      case 'join':
        // They will call: nothing to do until their offer comes.
        break;
      case 'leave':
        this.drop(m.id);
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
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
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
