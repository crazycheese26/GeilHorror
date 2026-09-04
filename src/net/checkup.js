// What is actually wrong with this connection.
//
// Peer-to-peer fails in a handful of ways that all look identical from the
// outside — a spinner that never stops — and almost none of them can be worked
// out from the game's own code. They are properties of the browser, the
// network and, embarrassingly often, a stale cached copy of the page.
//
// So: five checks that can each be run alone, in one browser, without needing
// somebody at the other end. Between them they separate "you are running last
// week's files", "this browser will not do WebRTC at all", "your network
// blocks STUN" and "the two of you genuinely cannot reach each other and need
// a relay" — which are four completely different conversations.
//
// No DOM here, the same as every other module that is not main.js.

import { getIceServers } from './peer.js';
import { topicFor } from './signal.js';

const CHECK_TIMEOUT = 9000;

// ok: true is fine, false is the problem, null is "worth knowing, not a fault".
function result(name, ok, detail) {
  return { name, ok, detail };
}

// Is this page even able to do any of it?
function checkContext(build) {
  const out = [];
  out.push(result('Page version', null, build));

  const secure = typeof window !== 'undefined' && window.isSecureContext;
  out.push(result('Secure context', !!secure, secure
    ? `yes — ${location.protocol}//${location.host}`
    : `no — ${location.protocol} cannot use WebRTC. Serve the game over https, ` +
      'or over http://localhost.'));

  const rtc = typeof RTCPeerConnection === 'function';
  out.push(result('WebRTC', rtc, rtc
    ? 'available'
    : 'this browser has no RTCPeerConnection. An extension or a privacy ' +
      'setting has switched it off.'));
  return out;
}

// Can this browser reach the lobby service, and how long does a message take
// to go out and come back?
async function checkLobby() {
  const topic = topicFor('checkup-' + Math.random().toString(36).slice(2, 8));
  const tag = 'ping-' + Math.random().toString(36).slice(2, 10);

  let socket;
  try {
    socket = new WebSocket(`wss://ntfy.sh/${topic}/ws`);
  } catch (err) {
    return result('Lobby service', false, 'could not open a WebSocket to ntfy.sh');
  }

  try {
    const opened = await Promise.race([
      new Promise(res => { socket.onopen = () => res(true); }),
      new Promise(res => { socket.onerror = () => res(false); }),
      wait(CHECK_TIMEOUT, false)
    ]);
    if (!opened) {
      return result('Lobby service', false,
        'ntfy.sh would not accept a WebSocket. A firewall or a DNS blocker is ' +
        'in the way; without it nobody can swap a code.');
    }

    const started = Date.now();
    const heard = new Promise(res => {
      socket.onmessage = (event) => {
        try {
          const m = JSON.parse(event.data);
          if (m.event === 'message' && m.message === tag) res(true);
        } catch (err) { /* not ours */ }
      };
    });

    const posted = await fetch(`https://ntfy.sh/${topic}`, { method: 'POST', body: tag })
      .then(r => r.ok ? null : `publishing answered ${r.status}`)
      .catch(() => 'publishing was blocked');
    if (posted) return result('Lobby service', false, posted);

    const got = await Promise.race([heard, wait(CHECK_TIMEOUT, false)]);
    return got
      ? result('Lobby service', true, `reachable, ${Date.now() - started} ms round trip`)
      : result('Lobby service', false,
        'a message published but never came back. The subscription is being ' +
        'blocked somewhere between here and ntfy.sh.');
  } finally {
    try { socket.close(); } catch (err) { /* already gone */ }
  }
}

// What kinds of address this browser can find for itself.
//
//   host   this machine's own addresses. Usually enough on one LAN.
//   srflx  what the internet sees you as, learned from STUN. This is the one
//          that lets two homes find each other, and a network that blocks it
//          is a network that cannot do peer-to-peer without a relay.
//   relay  a TURN server standing in the middle. Only appears if one is set.
async function checkCandidates() {
  if (typeof RTCPeerConnection !== 'function') {
    return result('Addresses found', false, 'skipped — no WebRTC');
  }

  const servers = getIceServers();
  const hasRelay = servers.some(s => /^turns?:/i.test(String(s.urls)));
  const pc = new RTCPeerConnection({ iceServers: servers });
  const counts = { host: 0, srflx: 0, relay: 0, prflx: 0 };
  const started = Date.now();

  try {
    pc.createDataChannel('checkup');
    pc.onicecandidate = (event) => {
      const line = event.candidate && event.candidate.candidate;
      if (!line) return;
      const type = (line.split(' ')[7] || '').toLowerCase();
      if (counts[type] !== undefined) counts[type]++;
    };
    await pc.setLocalDescription(await pc.createOffer());
    await Promise.race([
      new Promise(res => {
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') res();
        };
      }),
      wait(CHECK_TIMEOUT)
    ]);

    const took = Date.now() - started;
    const found = `host ${counts.host}, srflx ${counts.srflx}, relay ${counts.relay}`;
    const complete = pc.iceGatheringState === 'complete';

    if (!complete) {
      return result('Addresses found', false,
        `${found} — and the search never finished (${took} ms). A relay that ` +
        'is not answering will do this; check what is in the box below.');
    }
    if (counts.srflx === 0 && counts.relay === 0) {
      return result('Addresses found', false,
        `${found} in ${took} ms — no public address. Your network is blocking ` +
        'STUN, so this browser cannot tell anybody how to reach it. You will ' +
        'need a relay.');
    }
    if (hasRelay && counts.relay === 0) {
      return result('Addresses found', false,
        `${found} in ${took} ms — the relay you set produced nothing, so it is ` +
        'wrong, out of quota, or gone.');
    }
    return result('Addresses found', true, `${found} in ${took} ms`);
  } finally {
    try { pc.close(); } catch (err) { /* already gone */ }
  }
}

// Two connections inside this one page, talking to each other. It proves the
// browser can open a data channel at all — it says nothing about whether it
// can reach anybody else — so a pass here with a real run still failing means
// the problem is between the two of you, not in either browser.
async function checkLoopback() {
  if (typeof RTCPeerConnection !== 'function') {
    return result('Data channel', false, 'skipped — no WebRTC');
  }

  const servers = getIceServers();
  const a = new RTCPeerConnection({ iceServers: servers });
  const b = new RTCPeerConnection({ iceServers: servers });
  const started = Date.now();

  try {
    const channel = a.createDataChannel('checkup');
    a.onicecandidate = e => e.candidate && b.addIceCandidate(e.candidate).catch(noop);
    b.onicecandidate = e => e.candidate && a.addIceCandidate(e.candidate).catch(noop);

    await a.setLocalDescription(await a.createOffer());
    await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer());
    await a.setRemoteDescription(b.localDescription);

    const opened = await Promise.race([
      new Promise(res => { channel.onopen = () => res(true); }),
      wait(CHECK_TIMEOUT, false)
    ]);
    return opened
      ? result('Data channel', true, `opened in ${Date.now() - started} ms`)
      : result('Data channel', false,
        `never opened (${a.iceConnectionState}). This browser cannot make a ` +
        'peer connection even to itself — an extension or a policy is blocking it.');
  } catch (err) {
    return result('Data channel', false, String(err && err.message || err));
  } finally {
    try { a.close(); b.close(); } catch (err) { /* already gone */ }
  }
}

// `build` is the version stamp of the running page, which is here because a
// browser holding last week's copy of the game is the single most common
// reason a fix does not appear to have worked.
export async function runCheckup(build, relayText = '') {
  const checks = [...checkContext(build)];
  checks.push(await checkLobby());
  checks.push(await checkCandidates());
  checks.push(await checkLoopback());
  checks.push(result('Relay', null,
    relayText ? relayText.replace(/\|[^|]*$/, '|(password hidden)') : 'none set'));
  return checks;
}

// One block of text, for pasting at somebody who can read it.
export function checkupText(checks) {
  return checks
    .map(c => `${c.ok === true ? 'OK  ' : c.ok === false ? 'BAD ' : '--  '}${c.name}: ${c.detail}`)
    .join('\n');
}

function wait(ms, value) {
  return new Promise(res => setTimeout(() => res(value), ms));
}

function noop() {}
