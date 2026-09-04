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
// The offer is not trickled. Sending candidates as they arrive would be
// faster, but every one is a separate message through a rate-limited public
// lobby service, so the description is held until gathering finishes (or a
// deadline passes) and goes out as a single envelope.

// Free public STUN, which is all a direct connection needs: it only tells a
// browser what its own address looks like from outside.
//
// Two of them, and one relay below, is three URLs in total — deliberately.
// Browsers warn at five and gathering gets slower with every extra one,
// because each is tried before the deadline in GATHER_TIMEOUT expires.
const STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

// Two players behind strict (symmetric) NATs cannot reach each other directly
// and need a relay in the middle to copy packets between them. This is a free
// public one on 443, which is also the port most likely to be open. If it has
// gone away the game still connects for most people; anybody who wants a
// guaranteed relay can paste their own credentials in here.
const RELAY = [
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

export const ICE_SERVERS = [...STUN, ...RELAY];

// How long to wait for ICE gathering before sending what we have. A machine
// with a VPN and half a dozen virtual interfaces can spend a while enumerating
// them, and the candidates that matter arrive first.
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

    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 2 });

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'failed' || state === 'closed') this.fail();
    };

    if (initiator) {
      this.reliable = this.wire(this.pc.createDataChannel('evt', { ordered: true }));
      this.fast = this.wire(this.pc.createDataChannel('st', {
        ordered: false, maxRetransmits: 0
      }));
    } else {
      this.pc.ondatachannel = (event) => {
        const channel = this.wire(event.channel);
        if (channel.label === 'evt') this.reliable = channel;
        else this.fast = channel;
      };
    }
  }

  wire(channel) {
    channel.onopen = () => {
      // The reliable channel is the one the game waits on; the unreliable one
      // opens alongside it and is only ever an optimisation.
      if (channel.label === 'evt' && !this.ready && !this.closed) {
        this.ready = true;
        this.lastHeard = Date.now();
        if (this.onopen) this.onopen();
      }
    };
    channel.onclose = () => {
      if (channel.label === 'evt') this.fail();
    };
    channel.onmessage = (event) => this.receive(event.data);
    return channel;
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
    return this.pc.localDescription.sdp;
  }

  async acceptOffer(sdp) {
    await this.pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.gathered();
    return this.pc.localDescription.sdp;
  }

  async acceptAnswer(sdp) {
    if (this.pc.signalingState === 'stable') return;
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
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
    this.pc.ondatachannel = null;
    try { this.pc.close(); } catch (err) { /* already gone */ }
  }
}

function isOpen(channel) {
  return !!channel && channel.readyState === 'open';
}
