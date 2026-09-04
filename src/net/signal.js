// How two browsers find each other when nobody owns a server.
//
// GitHub Pages serves static files and nothing else, so the game cannot run a
// lobby. WebRTC solves the hard part — once two browsers have swapped a
// session description they talk directly, peer to peer, and no third party
// sees another byte — but somebody has to carry that first envelope.
//
// This module is that envelope, and it is carried by ntfy.sh: a free public
// pub/sub service that needs no account, no key and no server of ours. A room
// code hashes to a topic, everyone in the room subscribes to it over a
// WebSocket, and the four or five messages it takes to shake hands go through
// it. After that the topic goes quiet for the rest of the run.
//
// The two limits that shape the code below:
//
//   - a message body is capped at 4096 bytes, and a session description with a
//     dozen ICE candidates on it can beat that, so payloads are deflated and,
//     if they still do not fit, split across numbered chunks
//   - the free tier replenishes about a message every five seconds, so nothing
//     here polls or beacons; a joiner announces itself, the host answers, and
//     the channel is done

// Ordinary POST with a plain-text body and no custom headers, so the browser
// never has to preflight it. ntfy answers with Access-Control-Allow-Origin: *.
const NTFY = 'https://ntfy.sh';

// ntfy's body cap is 4096 bytes; leave room for the envelope around the chunk.
const MAX_CHUNK = 3400;

// Below this a payload is sent as-is: deflating a short string mostly adds
// base64 padding to it.
const COMPRESS_ABOVE = 700;

// The free tier is generous in bursts and slow to replenish, so publishes are
// spaced. Nothing in a handshake is latency-critical at this resolution.
const PUBLISH_GAP = 260;

// A half-finished chunked message from a peer that went away.
const CHUNK_TTL = 20000;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// A room code is five characters a person can read down a phone line: no O/0,
// no I/1. 32^5 is thirty-three million rooms, which is plenty for a game two
// people play on a Tuesday.
export function makeRoomCode() {
  let out = '';
  const bytes = new Uint8Array(5);
  (globalThis.crypto || {}).getRandomValues?.(bytes);
  for (let i = 0; i < 5; i++) {
    const n = bytes[i] || Math.floor(Math.random() * 256);
    out += CODE_ALPHABET[n % CODE_ALPHABET.length];
  }
  return out;
}

export function normaliseCode(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

export function isValidCode(text) {
  const code = normaliseCode(text);
  return code.length === 5 && [...code].every(ch => CODE_ALPHABET.includes(ch));
}

export function makePeerId() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

// The topic is a hash of the code rather than the code itself, so two rooms
// cannot collide with somebody else's unrelated ntfy topic and a passer-by
// cannot walk in by typing a plausible word. It is obscurity, not secrecy:
// the code is the only thing keeping a room private, which is the same deal
// as every party-code game.
function fnv(text, offset) {
  let h = offset >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function topicFor(code) {
  const key = `geil-stoomboot-v1|${normaliseCode(code)}`;
  const a = fnv(key, 0x811c9dc5).toString(36);
  const b = fnv(key, 0x9e3779b9).toString(36);
  return `geil${a}${b}`;
}

// --- Payload packing ----------------------------------------------------

const canCompress = typeof CompressionStream === 'function' &&
                    typeof DecompressionStream === 'function';

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deflate(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return bytesToBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
}

async function inflate(text) {
  const stream = new Blob([base64ToBytes(text)]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(stream).text();
}

// --- The channel --------------------------------------------------------

// One subscription to one room's topic. Everything on it is addressed: `to`
// null is the whole room, `to` a peer id is one browser, and a peer never
// hears its own traffic come back.
export class SignalChannel {
  constructor(code, selfId) {
    this.code = normaliseCode(code);
    this.topic = topicFor(this.code);
    this.selfId = selfId;

    this.ws = null;
    this.open = false;
    this.closed = false;

    this.queue = [];
    this.sending = false;
    this.lastPublish = 0;
    this.seq = 0;
    this.partial = new Map();
    this.retries = 0;

    // (from, kind, data)
    this.onmessage = null;
    // (state, detail) — 'open' | 'closed' | 'error'
    this.onstatus = null;
  }

  connect() {
    if (this.closed) return Promise.resolve(false);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };

      let socket;
      try {
        socket = new WebSocket(`wss://ntfy.sh/${this.topic}/ws`);
      } catch (err) {
        this.report('error', 'the lobby service could not be reached');
        finish(false);
        return;
      }
      this.ws = socket;

      socket.onopen = () => {
        this.open = true;
        this.retries = 0;
        this.report('open');
        finish(true);
      };

      socket.onmessage = (event) => this.receive(event.data);

      socket.onerror = () => {
        if (!this.open) {
          this.report('error', 'the lobby service could not be reached');
          finish(false);
        }
      };

      socket.onclose = () => {
        this.open = false;
        if (this.closed) return;
        // The handshake is short but a lobby can sit open for a while; come
        // back rather than stranding a room because a socket blinked.
        const wait = Math.min(8000, 700 * Math.pow(2, this.retries++));
        this.report('closed');
        setTimeout(() => { if (!this.closed) this.connect(); }, wait);
        finish(false);
      };
    });
  }

  report(state, detail) {
    if (this.onstatus) this.onstatus(state, detail);
  }

  // --- Sending ---------------------------------------------------------

  async send(kind, data, to = null) {
    if (this.closed) return;

    let body = JSON.stringify(data === undefined ? null : data);
    let compressed = 0;
    if (canCompress && body.length > COMPRESS_ABOVE) {
      try {
        const packed = await deflate(body);
        if (packed.length < body.length) {
          body = packed;
          compressed = 1;
        }
      } catch (err) { /* send it uncompressed rather than not at all */ }
    }

    const seq = this.seq++;
    const total = Math.max(1, Math.ceil(body.length / MAX_CHUNK));
    for (let i = 0; i < total; i++) {
      this.queue.push({
        v: 1, f: this.selfId, to, k: kind, c: compressed,
        s: seq, i, n: total,
        d: body.slice(i * MAX_CHUNK, (i + 1) * MAX_CHUNK)
      });
    }
    this.drain();
  }

  async drain() {
    if (this.sending) return;
    this.sending = true;

    while (this.queue.length && !this.closed) {
      const gap = PUBLISH_GAP - (Date.now() - this.lastPublish);
      if (gap > 0) await sleep(gap);
      if (this.closed) break;

      const envelope = this.queue[0];
      const ok = await this.publish(JSON.stringify(envelope));
      this.lastPublish = Date.now();
      if (ok) {
        this.queue.shift();
      } else {
        // Rate limited or offline. Back off and try the same envelope again;
        // dropping one mid-handshake strands a player in "connecting".
        await sleep(2500);
      }
    }

    this.sending = false;
  }

  async publish(body) {
    try {
      const res = await fetch(`${NTFY}/${this.topic}`, { method: 'POST', body });
      if (res.ok) return true;
      if (res.status === 429) this.report('error', 'the lobby service is busy — hold on');
      else this.report('error', `the lobby service answered ${res.status}`);
      return false;
    } catch (err) {
      this.report('error', 'no route to the lobby service');
      return false;
    }
  }

  // --- Receiving -------------------------------------------------------

  receive(raw) {
    let event;
    try {
      event = JSON.parse(raw);
    } catch (err) { return; }
    if (!event || event.event !== 'message' || typeof event.message !== 'string') return;

    let envelope;
    try {
      envelope = JSON.parse(event.message);
    } catch (err) { return; }
    if (!envelope || envelope.v !== 1 || typeof envelope.f !== 'string') return;
    // Everything published to the topic comes back to us as well.
    if (envelope.f === this.selfId) return;
    if (envelope.to && envelope.to !== this.selfId) return;

    const body = this.reassemble(envelope);
    if (body === null) return;

    if (envelope.c) {
      inflate(body)
        .then(text => this.deliver(envelope, text))
        .catch(() => { /* a corrupt payload is not worth a crash */ });
    } else {
      this.deliver(envelope, body);
    }
  }

  // Multi-part payloads arrive in order over one WebSocket, but a peer can
  // still vanish halfway through one, so half-built messages are swept.
  reassemble(envelope) {
    if (envelope.n <= 1) return envelope.d;

    const key = `${envelope.f}:${envelope.s}`;
    let entry = this.partial.get(key);
    if (!entry) {
      entry = { parts: new Array(envelope.n).fill(null), left: envelope.n, at: Date.now() };
      this.partial.set(key, entry);
    }
    if (entry.parts[envelope.i] === null) {
      entry.parts[envelope.i] = envelope.d;
      entry.left--;
    }

    const now = Date.now();
    for (const [k, v] of this.partial) {
      if (now - v.at > CHUNK_TTL) this.partial.delete(k);
    }

    if (entry.left > 0) return null;
    this.partial.delete(key);
    return entry.parts.join('');
  }

  deliver(envelope, body) {
    if (!this.onmessage) return;
    let data = null;
    try {
      data = JSON.parse(body);
    } catch (err) { return; }
    this.onmessage(envelope.f, envelope.k, data);
  }

  close() {
    this.closed = true;
    this.queue.length = 0;
    this.partial.clear();
    if (this.ws) {
      try { this.ws.close(); } catch (err) { /* already gone */ }
      this.ws = null;
    }
    this.open = false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
