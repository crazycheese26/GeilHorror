// A room: one host, up to three joiners, and the traffic between them.
//
// The shape is a star, not a mesh. Everyone connects to the host and nobody
// else, and the host forwards anything addressed past itself. Three
// connections instead of six, one clock instead of four, and the host is
// already the authority on the run — it is running Mr. Geil.
//
// The lobby service (see signal.js) is only used to swap session
// descriptions. The moment a data channel opens, the room stops publishing
// and every byte after that is peer to peer.

import { SignalChannel, makePeerId } from './signal.js';
import { Peer } from './peer.js';

export const MAX_PLAYERS = 4;

// A joiner announces itself, the host answers. If nothing comes back the code
// is wrong or the host has closed.
const JOIN_RETRY = 3200;
const JOIN_TIMEOUT = 22000;

// Descriptions were swapped and then nothing happened. That is not a lobby
// problem — it is two networks that will not let browsers reach each other —
// and it has to be said out loud rather than left spinning, because the fix
// (a relay) is something only a person can go and get.
const CONNECT_TIMEOUT = 20000;

// Late candidates are trickled after the fact, but the lobby topic is rate
// limited, so only a couple of follow-ups are worth sending.
const MAX_TRICKLE = 3;

// Cheap liveness: a laptop lid closing does not always close a data channel.
const PING_INTERVAL = 2500;

export class Room {
  constructor({ code, host, name }) {
    this.code = code;
    this.isHost = !!host;
    this.name = name;
    this.selfId = makePeerId();
    this.hostId = this.isHost ? this.selfId : null;

    this.peers = new Map();      // id -> Peer
    this.names = new Map();      // id -> display name
    this.locked = false;         // host: no more joiners
    this.closed = false;

    this.onjoin = null;          // (id, name)
    this.onleave = null;         // (id, wasHost)
    this.onmessage = null;       // (from, kind, data)
    this.onstatus = null;        // (state, detail)

    this.signal = new SignalChannel(code, this.selfId);
    this.signal.onmessage = (from, kind, data) => this.handleSignal(from, kind, data);
    this.signal.onstatus = (state, detail) => {
      if (state === 'error') this.report('error', detail);
    };

    this.heartbeat = null;
    this.joinTimer = null;
    this.joinDeadline = 0;
  }

  report(state, detail) {
    if (this.onstatus) this.onstatus(state, detail);
  }

  // --- Opening ---------------------------------------------------------

  async open() {
    const connected = await this.signal.connect();
    if (!connected) return false;

    this.heartbeat = setInterval(() => this.tick(), PING_INTERVAL);

    if (this.isHost) {
      this.report('hosting', this.code);
      return true;
    }

    this.report('joining', this.code);
    this.joinDeadline = Date.now() + JOIN_TIMEOUT;
    this.announce();
    this.joinTimer = setInterval(() => {
      if (this.closed) return;
      if (this.hostId) {
        clearInterval(this.joinTimer);
        this.joinTimer = null;
        return;
      }
      if (Date.now() > this.joinDeadline) {
        clearInterval(this.joinTimer);
        this.joinTimer = null;
        this.report('nohost', this.code);
        return;
      }
      this.announce();
    }, JOIN_RETRY);
    return true;
  }

  announce() {
    this.signal.send('join', { name: this.name });
  }

  // --- Handshake -------------------------------------------------------

  handleSignal(from, kind, data) {
    if (this.closed) return;

    if (kind === 'join' && this.isHost) {
      this.greet(from, data);
      return;
    }
    if (kind === 'offer' && !this.isHost) {
      this.answer(from, data);
      return;
    }
    if (kind === 'answer' && this.isHost) {
      const peer = this.peers.get(from);
      if (peer) peer.acceptAnswer(data.sdp).catch(() => peer.fail());
      return;
    }
    if (kind === 'ice') {
      const peer = this.peers.get(from);
      if (peer && data) {
        for (const candidate of data.candidates || []) peer.addRemoteCandidate(candidate);
      }
      return;
    }
    if (kind === 'shut' && !this.isHost && from === this.hostId) {
      this.report('hostleft');
      return;
    }
    if (kind === 'full' && !this.isHost && !this.hostId) {
      this.report('full', data && data.reason);
    }
  }

  // Host side: somebody knocked.
  async greet(id, data) {
    if (this.peers.has(id)) return;
    if (this.locked) {
      this.signal.send('full', { reason: 'the run has already started' }, id);
      return;
    }
    if (this.peers.size + 1 >= MAX_PLAYERS) {
      this.signal.send('full', { reason: 'the boat is full' }, id);
      return;
    }

    const peer = this.adopt(id, true);
    this.names.set(id, cleanName(data && data.name));
    try {
      const sdp = await peer.createOffer();
      if (this.closed || peer.closed) return;
      this.signal.send('offer', { sdp }, id);
    } catch (err) {
      this.drop(id);
    }
  }

  // Joiner side: the host answered.
  async answer(id, data) {
    // First offer wins. A second one means two people typed the same code as
    // a host, which is not worth handling beyond ignoring it.
    if (this.hostId || !data || !data.sdp) return;
    this.hostId = id;

    const peer = this.adopt(id, false);
    try {
      const sdp = await peer.acceptOffer(data.sdp);
      if (this.closed || peer.closed) return;
      this.signal.send('answer', { sdp }, id);
      this.report('handshaking');
    } catch (err) {
      this.hostId = null;
      this.drop(id);
      this.report('error', 'the handshake failed — try the code again');
    }
  }

  adopt(id, initiator) {
    const peer = new Peer(id, { initiator });

    // Anything ICE turns up after the description has gone out, batched into
    // at most a few follow-up messages rather than one per candidate.
    let pending = [];
    let trickles = 0;
    let flush = null;
    peer.onLateCandidate = (candidate) => {
      if (this.closed || peer.ready || trickles >= MAX_TRICKLE) return;
      pending.push(candidate);
      if (flush) return;
      flush = setTimeout(() => {
        flush = null;
        if (this.closed || peer.ready || !pending.length) return;
        trickles++;
        this.signal.send('ice', { candidates: pending }, id);
        pending = [];
      }, 500);
    };

    // Descriptions swapped, channels never opened.
    const watchdog = setTimeout(() => {
      if (this.closed || peer.closed || peer.ready) return;
      this.report('nodirect', peer.summary());
      peer.fail();
    }, CONNECT_TIMEOUT);

    peer.onopen = () => {
      clearTimeout(watchdog);
      if (flush) clearTimeout(flush);
      // Names travel over the connection, not the lobby, so a name never
      // sits in a public topic.
      peer.send('hi', { name: this.name });
      if (this.onjoin) this.onjoin(id, this.names.get(id) || 'Piet');
    };
    peer.onclose = () => {
      clearTimeout(watchdog);
      if (flush) clearTimeout(flush);
      this.drop(id);
    };
    peer.onmessage = (kind, packet) => this.route(id, kind, packet);
    this.peers.set(id, peer);
    return peer;
  }

  // --- Traffic ---------------------------------------------------------

  // A packet arriving over a connection. `packet.f` is who first sent it,
  // which is not the peer it came from when the host is relaying.
  route(via, kind, packet) {
    if (kind === 'hi') {
      this.names.set(via, cleanName(packet && packet.name));
      return;
    }
    if (kind !== 'msg' || !packet) return;

    const from = packet.f || via;
    const to = packet.to || null;

    // Host: pass anything not addressed to us along to whoever it is for.
    if (this.isHost && to !== this.selfId) {
      for (const [id, peer] of this.peers) {
        if (id === via) continue;
        if (to && id !== to) continue;
        peer.send('msg', packet, packet.r !== false);
      }
      if (to) return;
    }

    if (this.onmessage) this.onmessage(from, packet.k, packet.d);
  }

  // to: a peer id, or null for everyone else in the room.
  send(kind, data, { to = null, reliable = true } = {}) {
    if (this.closed) return;
    const packet = { f: this.selfId, to, k: kind, d: data, r: reliable };

    if (this.isHost) {
      for (const [id, peer] of this.peers) {
        if (to && id !== to) continue;
        peer.send('msg', packet, reliable);
      }
      return;
    }
    // A joiner only has one connection; the host sorts out where it goes.
    const host = this.hostId ? this.peers.get(this.hostId) : null;
    if (host) host.send('msg', packet, reliable);
  }

  // --- Upkeep ----------------------------------------------------------

  tick() {
    if (this.closed) return;
    for (const peer of [...this.peers.values()]) {
      if (peer.isStale()) {
        peer.fail();
        continue;
      }
      if (peer.ready) peer.ping();
    }
  }

  drop(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    // Worked out before hostId is cleared, because whether the host is the one
    // who left is the difference between a crewmate gone and a run over.
    const wasHost = !this.isHost && id === this.hostId;
    this.peers.delete(id);
    this.names.delete(id);
    peer.close();
    if (wasHost) {
      this.hostId = null;
      this.report('hostleft');
    }
    if (this.onleave) this.onleave(id, wasHost);
  }

  // Stop taking joiners without closing the room: the run has begun.
  lock() {
    this.locked = true;
  }

  unlock() {
    this.locked = false;
  }

  playerCount() {
    return this.peers.size + 1;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.joinTimer) clearInterval(this.joinTimer);
    // Best effort: tell anyone still listening on the lobby topic, in case a
    // joiner is mid-handshake and would otherwise wait out the timeout.
    if (this.isHost) this.signal.send('shut', {});
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    this.names.clear();
    // Give the parting message a moment to reach the wire.
    setTimeout(() => this.signal.close(), 400);
  }
}

function cleanName(text) {
  const name = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 14);
  return name || 'Piet';
}
