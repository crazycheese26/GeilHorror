// One WebRTC connection to one other browser.
//
// Two channels, because the game sends two kinds of thing:
//
//   evt  reliable and ordered — a pakje was torn open, somebody went down,
//        the run started. Losing one of these desyncs the run.
//   st   unreliable and unordered — where everybody is, fifteen times a
//        second. A dropped one is replaced by the next one 66 ms later, and
//        waiting for a retransmit would only ever make the avatar late.
//
// The description is not trickled. Sending candidates as they arrive would be
// faster, but every one is a separate message through a rate-limited public
// lobby service, so gathering is allowed to finish and the description goes
// out complete. Anything that turns up after the deadline is trickled after
// the fact rather than lost — see onLateCandidate.

// Free public STUN. It is not a relay and it does not carry any traffic: it
// only tells a browser what its own address looks like from outside, which is
// what lets two home connections find each other directly.
//
// There is deliberately no TURN server in here by default. The well-known free
// public ones are all either gone or require an account, and a dead one is
// worse than none at all: ICE gathering waits for it, never completes, and
// every connection pays the full timeout below before it can even start. If
// you need a relay — see setRelay, and the lobby's Relay box.
const STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

let relayServers = [];

// A relay for the pairs that cannot reach each other directly: both behind
// carrier-grade NAT, a corporate firewall, a VPN that will not hairpin. One
// side having one is enough for both. Free tiers exist and none of them are a
// server you run; the README says where to get one.
//
// Accepts the shapes people are actually given:
//   turn:host:3478|user|pass
//   turns:host:5349?transport=tcp|user|pass
//   turn:user:pass@host:3478
export function parseRelay(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const piped = raw.split('|').map(s => s.trim()).filter(Boolean);
  if (piped.length >= 3) {
    return { urls: piped[0], username: piped[1], credential: piped.slice(2).join('|') };
  }

  const at = raw.match(/^(turns?):([^:@/]+):([^@]+)@(.+)$/i);
  if (at) {
    return { urls: `${at[1]}:${at[4]}`, username: at[2], credential: at[3] };
  }

  // A bare URL. Legal — some relays are open — but usually a sign somebody
  // pasted half of what they were given.
  if (/^turns?:/i.test(raw)) return { urls: raw };
  return null;
}

export function setRelay(text) {
  const server = parseRelay(text);
  relayServers = server ? [server] : [];
  return server;
}

export function getIceServers() {
  return [...STUN, ...relayServers];
}

export const ICE_SERVERS = getIceServers();

// How long to wait for ICE gathering before sending what we have. With only
// STUN in the list it finishes in well under a second; this is the ceiling for
// a machine with a VPN and half a dozen virtual interfaces, or a relay that is
// not answering.
const GATHER_TIMEOUT = 2600;

// No traffic for this long with a channel still open means the other end is
// gone — a laptop lid, a lost tunnel — and the socket has not noticed.
const SILENCE_TIMEOUT = 9000;

export class Peer {
  constructor(id, { initiator = false } = {}) {
    this.id = id;
    this.initiator = initiator;
    this.closed = false;
    this.ready = false;
    this.lastHeard = Date.now();
    this.rtt = 0;

    this.onopen = null;
    this.onclose = null;
    // (kind, data)
    this.onmessage = null;
    // (candidate) — one that turned up after the description was sent.
    this.onLateCandidate = null;

    // Everything a person would need to work out why this did not connect.
    // Kept whether or not it does, because the useful moment to look is after
    // it has already failed.
    this.trail = {
      candidates: { host: 0, srflx: 0, relay: 0, prflx: 0 },
      gatherMs: null,
      states: [],
      sentAt: null
    };
    this.gatherStart = Date.now();
    this.described = false;

    this.pc = new RTCPeerConnection({ iceServers: getIceServers() });

    this.pc.onicecandidate = (event) => this.onCandidate(event.candidate);

    this.pc.oniceconnectionstatechange = () => this.note('ice', this.pc.iceConnectionState);
    this.pc.onicegatheringstatechange = () => {
      if (this.pc.iceGatheringState === 'complete' && this.trail.gatherMs === null) {
        this.trail.gatherMs = Date.now() - this.gatherStart;
      }
    };
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      this.note('conn', state);
      if (state === 'failed' || state === 'closed') this.fail();
    };

    if (initiator) {
      this.reliable = this.adopt(this.pc.createDataChannel('evt', { ordered: true }));
      this.fast = this.adopt(this.pc.createDataChannel('st', {
        ordered: false, maxRetransmits: 0
      }));
    } else {
      this.pc.ondatachannel = (event) => {
        // Assigned before it is wired: some browsers hand the answering side a
        // channel that is already open, so wiring it can call straight back
        // into onopen, and that has to find the channel already in place.
        const channel = event.channel;
        if (channel.label === 'evt') this.reliable = channel;
        else this.fast = channel;
        this.adopt(channel);
      };
    }
  }

  note(kind, state) {
    this.trail.states.push(`${kind}=${state}`);
  }

  onCandidate(candidate) {
    if (!candidate || !candidate.candidate) return;
    const type = (candidate.candidate.split(' ')[7] || '').toLowerCase();
    if (this.trail.candidates[type] !== undefined) this.trail.candidates[type]++;
    // Anything found after the description went out has to be sent separately
    // or it may as well not have been found.
    if (this.described && this.onLateCandidate) {
      this.onLateCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex
      });
    }
  }

  // What went wrong, in one line a person can paste into a bug report.
  summary() {
    const c = this.trail.candidates;
    const found = ['host', 'srflx', 'relay']
      .map(k => `${k} ${c[k]}`).join(', ');
    const gather = this.trail.gatherMs === null
      ? 'gathering never finished'
      : `gathered in ${this.trail.gatherMs} ms`;
    const last = this.trail.states.slice(-4).join(' → ') || 'no state changes';
    return `${found}; ${gather}; ${last}`;
  }

  adopt(channel) {
    channel.onopen = () => this.opened(channel);
    channel.onclose = () => {
      if (channel.label === 'evt') this.fail();
    };
    channel.onmessage = (event) => this.receive(event.data);
    // A channel handed over already open never fires the event.
    if (channel.readyState === 'open') this.opened(channel);
    return channel;
  }

  opened(channel) {
    // The reliable channel is the one the game waits on; the unreliable one
    // opens alongside it and is only ever an optimisation.
    if (channel.label !== 'evt' || this.ready || this.closed) return;
    this.ready = true;
    this.lastHeard = Date.now();
    this.note('open', 'evt');
    if (this.onopen) this.onopen();
  }

  receive(raw) {
    this.lastHeard = Date.now();
    let packet;
    try {
      packet = JSON.parse(raw);
    } catch (err) { return; }
    if (!packet || typeof packet.k !== 'string') return;

    if (packet.k === 'ping') {
      this.rawSend({ k: 'pong', d: packet.d }, false);
      return;
    }
    if (packet.k === 'pong') {
      this.rtt = Date.now() - (packet.d || Date.now());
      return;
    }
    if (this.onmessage) this.onmessage(packet.k, packet.d);
  }

  // --- Handshake -------------------------------------------------------

  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.gathered();
    return this.describe();
  }

  async acceptOffer(sdp) {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.gathered();
    return this.describe();
  }

  async acceptAnswer(sdp) {
    if (this.pc.signalingState === 'stable') return;
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  // A candidate the other side found after it had already sent its
  // description. Ignored rather than thrown on: a late candidate arriving
  // after the connection is up is not a problem worth surfacing.
  async addRemoteCandidate(candidate) {
    if (this.closed || !candidate) return;
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) { /* nothing to be done about it here */ }
  }

  describe() {
    this.described = true;
    this.trail.sentAt = Date.now() - this.gatherStart;
    return this.pc.localDescription.sdp;
  }

  gathered() {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => { if (this.pc.iceGatheringState === 'complete') done(); };
      const timer = setTimeout(done, GATHER_TIMEOUT);
      this.pc.addEventListener('icegatheringstatechange', check);
    });
  }

  // --- Traffic ---------------------------------------------------------

  send(kind, data, reliable = true) {
    this.rawSend({ k: kind, d: data }, reliable);
  }

  rawSend(packet, reliable) {
    if (this.closed) return false;
    // Fall back to the ordered channel rather than dropping a packet because
    // the unreliable one has not finished opening yet.
    const channel = (!reliable && isOpen(this.fast)) ? this.fast : this.reliable;
    if (!isOpen(channel)) return false;
    try {
      channel.send(JSON.stringify(packet));
      return true;
    } catch (err) {
      return false;
    }
  }

  ping() {
    this.rawSend({ k: 'ping', d: Date.now() }, false);
  }

  // A connection whose channels are open but silent is dead in every way that
  // matters to the run.
  isStale() {
    return this.ready && Date.now() - this.lastHeard > SILENCE_TIMEOUT;
  }

  fail() {
    if (this.closed) return;
    this.close();
    if (this.onclose) this.onclose();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    for (const channel of [this.reliable, this.fast]) {
      if (!channel) continue;
      channel.onopen = channel.onclose = channel.onmessage = null;
      try { channel.close(); } catch (err) { /* already gone */ }
    }
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.onicegatheringstatechange = null;
    this.pc.onicecandidate = null;
    this.pc.ondatachannel = null;
    try { this.pc.close(); } catch (err) { /* already gone */ }
  }
}

function isOpen(channel) {
  return !!channel && channel.readyState === 'open';
}
