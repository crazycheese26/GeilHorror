// The other people on the boat.
//
// Every player is drawn on every other player's screen as a billboarded
// sprite, the same trick Mr. Geil is drawn with, and fed from a stream of
// positions arriving fifteen times a second. Fifteen is far below the frame
// rate, so nothing is drawn where a packet said: the last two are kept and the
// avatar is rendered a tenth of a second in the past, between them. That one
// decision is the difference between crewmates who walk and crewmates who
// teleport.
//
// One rule from the rest of the game applies here with force: lights are made
// once and dimmed, never added and removed. A crewmate's torch is a real
// spotlight — seeing a friend's beam swing across a bulkhead at the end of a
// corridor is most of why co-op is worth playing — and adding one mid-run
// would recompile every material in the scene. All of them are built when the
// crew is, in the lobby, before anybody is playing.

import { TextureFactory } from './textures.js';
import { horrorAudio } from './audio.js';

// Render this far behind the newest packet, so there is always a later one to
// interpolate toward. Roughly one and a half send intervals.
const INTERP_DELAY = 0.1;

// Beyond this a crewmate has not been heard from and is drawn where they were
// last seen rather than extrapolated into a bulkhead.
const STALE_AFTER = 1.5;

const SPRITE_HEIGHT = 1.62;
const SPRITE_ASPECT = 415 / 489;

// Nameplates are for the crew, not for Mr. Geil, and only close to. They are
// world-space sprites, so left at a fixed size one fills the screen when
// somebody is stood on you and is a smudge at the far end of a corridor; the
// scale below is walked with the distance so it reads about the same either
// way, and it is off entirely inside arm's reach where it is only in the way.
const NAME_RANGE = 13;
const NAME_MIN_RANGE = 1.7;
const NAME_WIDTH = 0.17;   // metres of plate per metre of distance

// A crewmate's torch. Dimmer than your own and without shadows: four
// shadow-casting spotlights in a corridor is a real cost for something that is
// scenery, and the beam still reads.
const CREW_TORCH = 2.2;

// The palette other players are tinted with. Kept close to the game's own
// bone-and-amber so nobody looks like a different game, but far enough apart
// to be told at a glance down a dark corridor.
export const CREW_COLOURS = [
  { key: 'bone',   hex: 0xd9d3c4, css: '#d9d3c4' },
  { key: 'amber',  hex: 0xd59a4e, css: '#d59a4e' },
  { key: 'teal',   hex: 0x5fa8a0, css: '#5fa8a0' },
  { key: 'violet', hex: 0x9d7cc4, css: '#9d7cc4' }
];

export function crewColour(index) {
  return CREW_COLOURS[index % CREW_COLOURS.length];
}

export class CrewView {
  // `slots` is how many other players this run can hold. Every light and mesh
  // for all of them is built now, empty, and reused as people come and go.
  constructor(scene, slots = 3) {
    this.scene = scene;
    this.avatars = new Map();     // player id -> slot
    this.free = [];
    this.disposables = [];

    this.texture = null;
    this.loadSprite();

    this.shadowTexture = TextureFactory.createBlobShadow();
    this.disposables.push(this.shadowTexture);

    for (let i = 0; i < slots; i++) this.free.push(this.buildSlot());
  }

  // The sprite already carries its own alpha, so unlike the Mr. Geil sketch
  // there is no paper to key out of it.
  loadSprite() {
    const img = new Image();
    img.onload = () => {
      const texture = new THREE.Texture(img);
      texture.needsUpdate = true;
      texture.encoding = THREE.sRGBEncoding;
      texture.anisotropy = TextureFactory.maxAnisotropy;
      this.texture = texture;
      this.disposables.push(texture);
      for (const slot of this.allSlots()) slot.material.map = texture;
      for (const slot of this.allSlots()) slot.material.needsUpdate = true;
    };
    img.onerror = () => console.warn('assets/PlayerSprite.png failed to load');
    img.src = 'assets/PlayerSprite.png';
  }

  allSlots() {
    return [...this.free, ...this.avatars.values()];
  }

  buildSlot() {
    const width = SPRITE_HEIGHT * SPRITE_ASPECT;
    const geo = new THREE.PlaneGeometry(width, SPRITE_HEIGHT);
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      color: 0xffffff,
      fog: true
    });
    const sprite = new THREE.Mesh(geo, material);
    sprite.renderOrder = 2;
    sprite.visible = false;
    this.scene.add(sprite);

    const shadowGeo = new THREE.PlaneGeometry(width * 0.9, width * 0.5);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.shadowTexture, transparent: true, depthWrite: false, opacity: 0.55
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.visible = false;
    this.scene.add(shadow);

    // Built here and never removed. See the note at the top of the file.
    const torch = new THREE.SpotLight(0xffe9cc, 0, 24, Math.PI / 5.6, 0.6, 1.6);
    torch.castShadow = false;
    const torchTarget = new THREE.Object3D();
    this.scene.add(torch, torchTarget);
    torch.target = torchTarget;

    // A crewmate on the deck is the one thing you want to be able to find, so
    // they get a halo the way a pakje does.
    const haloMat = new THREE.SpriteMaterial({
      map: this.shadowTexture, color: 0xa3252a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(3.4, 3.4, 1);
    halo.visible = false;
    this.scene.add(halo);

    this.disposables.push(geo, material, shadowGeo, shadowMat, haloMat);

    return {
      sprite, material, shadow, shadowMat, torch, torchTarget, halo, haloMat,
      nameSprite: null, nameMat: null, nameTex: null,
      buffer: [], bob: 0, lastStep: 0, id: null, player: null
    };
  }

  // --- Roster ----------------------------------------------------------

  // `players` is the run's roster minus whoever is holding this camera.
  setRoster(players) {
    const wanted = new Set(players.map(p => p.id));
    for (const id of [...this.avatars.keys()]) {
      if (!wanted.has(id)) this.release(id);
    }
    for (const player of players) {
      if (!this.avatars.has(player.id)) this.claim(player);
      const slot = this.avatars.get(player.id);
      if (slot) slot.player = player;
    }
  }

  claim(player) {
    const slot = this.free.pop();
    // More players than slots can only happen if the room's cap moved; drawing
    // three of four is better than throwing on the fourth.
    if (!slot) return;
    slot.id = player.id;
    slot.player = player;
    slot.buffer.length = 0;
    slot.bob = 0;
    slot.material.color.setHex(player.colour !== undefined ? player.colour : 0xffffff);
    this.setName(slot, player.name, player.css || '#d9d3c4');
    this.avatars.set(slot.id, slot);
  }

  release(id) {
    const slot = this.avatars.get(id);
    if (!slot) return;
    this.avatars.delete(id);
    this.hide(slot);
    slot.id = null;
    slot.player = null;
    slot.buffer.length = 0;
    this.free.push(slot);
  }

  setName(slot, name, css) {
    if (slot.nameSprite) {
      this.scene.remove(slot.nameSprite);
      dropAll([slot.nameMat, slot.nameTex], this.disposables);
    }
    const texture = TextureFactory.createNameplate(name, css);
    const material = new THREE.SpriteMaterial({
      map: texture, transparent: true, depthWrite: false, opacity: 0, fog: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1, 0.25, 1);
    sprite.visible = false;
    this.scene.add(sprite);

    slot.nameSprite = sprite;
    slot.nameMat = material;
    slot.nameTex = texture;
    this.disposables.push(material, texture);
  }

  // --- Incoming positions ----------------------------------------------

  // One packet from one player. `at` is this browser's clock, not theirs: the
  // two are never synchronised and never need to be, because only the gaps
  // between arrivals matter.
  push(id, frame, at) {
    const slot = this.avatars.get(id);
    if (!slot) return;
    const buffer = slot.buffer;
    buffer.push({ ...frame, at });
    // Two to interpolate between and one spare for a late packet.
    while (buffer.length > 4) buffer.shift();
  }

  // --- Per-frame -------------------------------------------------------

  // `viewer` is whoever is holding the camera; `showNames` is false for the
  // person playing Mr. Geil, who does not get to read the crew off the dark.
  update(delta, viewer, { showNames = true } = {}) {
    const now = performance.now() / 1000;
    const target = now - INTERP_DELAY;

    for (const slot of this.avatars.values()) {
      const frame = sample(slot.buffer, target);
      if (!frame || (slot.player && slot.player.present === false)) {
        this.hide(slot);
        continue;
      }
      this.paint(slot, frame, viewer, delta, now, showNames);
    }
  }

  paint(slot, frame, viewer, delta, now, showNames) {
    // He took the body with him.
    if (frame.dead) {
      this.hide(slot);
      return;
    }

    const stance = frame.down ? 0.55 : frame.sneak ? 0.78 : 1;
    const height = SPRITE_HEIGHT * stance;

    slot.sprite.visible = true;
    slot.sprite.scale.set(stance, stance, 1);
    slot.sprite.position.set(frame.x, height / 2 + 0.02, frame.z);
    // Yaw-only billboard, so a crewmate stays upright rather than tipping to
    // face a camera looking down at them.
    slot.sprite.rotation.set(
      0,
      Math.atan2(viewer.x - frame.x, viewer.z - frame.z),
      frame.down ? 1.35 : 0
    );

    const dist = Math.hypot(viewer.x - frame.x, viewer.z - frame.z);

    slot.shadow.visible = true;
    slot.shadow.position.set(frame.x, 0.03, frame.z);
    slot.shadowMat.opacity = frame.down ? 0.35 : 0.5;

    // Their torch, pointed where they are looking.
    const lit = frame.torch && !frame.down;
    slot.torch.intensity = lit ? CREW_TORCH : 0;
    if (lit) {
      slot.torch.position.set(frame.x, 1.5 * stance, frame.z);
      slot.torchTarget.position.set(
        frame.x - Math.sin(frame.yaw) * 6,
        1.2,
        frame.z - Math.cos(frame.yaw) * 6
      );
    }

    // A downed crewmate pulses so they can be found from down the corridor.
    slot.halo.visible = !!frame.down;
    if (slot.halo.visible) {
      slot.halo.position.set(frame.x, 0.7, frame.z);
      slot.haloMat.opacity = 0.28 + Math.sin(now * 4.2) * 0.14;
    }

    if (slot.nameSprite) {
      const show = showNames && dist < NAME_RANGE && dist > NAME_MIN_RANGE;
      slot.nameSprite.visible = show;
      if (show) {
        const width = dist * NAME_WIDTH;
        slot.nameSprite.scale.set(width, width * 0.25, 1);
        slot.nameSprite.position.set(frame.x, height + 0.3 + width * 0.2, frame.z);
        slot.nameMat.opacity = Math.min(0.8, (1 - dist / NAME_RANGE) * 1.5);
      }
    }

    this.footsteps(slot, frame, dist, delta, now);
  }

  // A crewmate's footfalls, attenuated the way Mr. Geil's are. This is not
  // decoration: it is how the person playing him works out where you went, and
  // how a crew keeps track of each other with their torches off.
  footsteps(slot, frame, dist, delta, now) {
    const gait = frame.gait || 'still';
    if (gait === 'still' || frame.down) return;

    const carry = gait === 'sprint' ? 26 : gait === 'sneak' ? 6 : 15;
    if (dist > carry) return;

    const rate = gait === 'sprint' ? 3.9 : gait === 'sneak' ? 1.5 : 2.7;
    slot.bob += delta * rate;
    if (slot.bob < 1) return;
    slot.bob -= 1;
    if (now - slot.lastStep < 0.14) return;
    slot.lastStep = now;
    horrorAudio.playCrewStep(dist, carry, gait);
  }

  hide(slot) {
    slot.sprite.visible = false;
    slot.shadow.visible = false;
    slot.halo.visible = false;
    slot.torch.intensity = 0;
    if (slot.nameSprite) slot.nameSprite.visible = false;
  }

  hideAll() {
    for (const slot of this.avatars.values()) this.hide(slot);
  }

  clear() {
    for (const id of [...this.avatars.keys()]) this.release(id);
  }

  dispose() {
    this.clear();
    for (const slot of this.free) {
      this.scene.remove(slot.sprite, slot.shadow, slot.torch, slot.torchTarget, slot.halo);
      if (slot.nameSprite) this.scene.remove(slot.nameSprite);
    }
    this.free.length = 0;
    for (const item of this.disposables) {
      if (item && typeof item.dispose === 'function') item.dispose();
    }
    this.disposables.length = 0;
  }
}

// The two packets straddling `target`, blended. Falls back to holding the
// newest one, which is what a crewmate standing still looks like anyway.
function sample(buffer, target) {
  if (!buffer.length) return null;
  const newest = buffer[buffer.length - 1];
  if (target >= newest.at) {
    // Nothing newer to walk toward. Hold, unless they have been quiet long
    // enough that they are probably gone.
    return target - newest.at > STALE_AFTER ? null : newest;
  }

  for (let i = buffer.length - 1; i > 0; i--) {
    const b = buffer[i];
    const a = buffer[i - 1];
    if (target >= a.at && target <= b.at) {
      const span = b.at - a.at;
      const t = span > 0 ? (target - a.at) / span : 1;
      return {
        ...b,
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        yaw: a.yaw + angleDelta(b.yaw, a.yaw) * t
      };
    }
  }
  return buffer[0];
}

function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function dropAll(items, tracked) {
  for (const item of items) {
    if (!item) continue;
    const i = tracked.indexOf(item);
    if (i >= 0) tracked.splice(i, 1);
    if (typeof item.dispose === 'function') item.dispose();
  }
}
