// A run with other people in it.
//
// The ship is not sent over the wire. Every browser deals its own from the
// run's seed — layout.js is deterministic, so the pakjes, the pillow inside
// each one, Mr. Geil's berth, his circuit and the dead lanterns all come out
// identical without a byte being spent on them. What actually travels is only
// what a seed cannot predict: where people are, and what they have done.
//
// The host is the authority on the world. It runs Mr. Geil, it decides who he
// caught, it rules on who opened which pakje and when the offering is made.
// It is not the authority on where anybody is standing: every player walks
// their own body at full frame rate and simply says where they ended up, which
// is the difference between a corridor that feels solid under you and one you
// are dragged back down every time the connection hiccups. Nobody is cheating
// their friends out of a Sinterklaas horror game.
//
// Two modes:
//   coop  Mr. Geil is the AI, on the host's machine, hunting everyone at once.
//   hunt  one player is Mr. Geil. The AI is off on every browser and his body
//         arrives down the wire the same way a crewmate's does.

import { STATE } from '../enemy.js';
import { crewColour } from '../crew.js';

export const MODE = { COOP: 'coop', HUNT: 'hunt' };

// Positions, fifteen a second. Below the frame rate on purpose: crew.js
// interpolates, and the ear cannot hear the difference in a footstep.
const SEND_HZ = 15;

// Caught with a crew is not the end of you. Somebody has to come and get you.
export const BLEED_SECONDS = 48;
const REVIVE_SECONDS = 4.0;
const REVIVE_RANGE = 2.4;

// A person playing Mr. Geil can make sure of somebody, but it costs them the
// time they would otherwise spend hunting the ones still upright.
const FINISH_SECONDS = 2.5;
const FINISH_RANGE = 2.2;

// After the AI takes somebody it wanders off, so a rescue is a thing that can
// be attempted. Standing over the body is still a bad idea.
const SATE_SECONDS = 5;

// With nobody left upright there is nobody coming, and a body on the deck is
// just a countdown nobody is watching. He finishes it.
const ABANDONED_BLEED = 6;

// The hunter's sense of you: a pulse, and how far a gait carries to it.
const REUK_INTERVAL = 3.4;
const REUK_RANGE = { still: 0, sneak: 8, walk: 24, sprint: 46 };

// Flag bits on a player frame.
const F_TORCH = 1;
const F_HIDDEN = 2;
const F_SNEAK = 4;
const F_DOWN = 8;
const F_DEAD = 16;
const F_OFFERING = 32;

const GAITS = ['still', 'sneak', 'walk', 'sprint'];

export class NetSession {
  // `game` is the thing that owns the world and the screen; see main.js. The
  // session never touches the DOM and never touches Three.js — it moves state
  // between the wire and the simulation, and tells the game when something
  // happened that a person should be told about.
  constructor({ room, game, name }) {
    this.room = room;
    this.game = game;
    this.isHost = room.isHost;
    this.localId = room.selfId;

    this.mode = MODE.COOP;
    this.hunterId = null;
    this.seed = null;
    this.phase = 'lobby';        // lobby | run | over
    this.outcome = null;

    this.players = new Map();
    this.addPlayer(this.localId, name, true);

    this.sendTimer = 0;
    this.tick = 0;        // the host's snapshot counter
    this.snapTick = -1;   // the newest snapshot this browser has applied
    this.reviveTarget = null;
    this.reviveProgress = 0;
    this.finishProgress = 0;
    // dx/dz is a direction rather than an angle, so main.js can put it through
    // the same projection the threat ring already uses.
    this.reuk = { strength: 0, dx: 0, dz: 1, timer: 0, name: null };

    room.onjoin = (id, peerName) => this.onJoin(id, peerName);
    room.onleave = (id, wasHost) => this.onLeave(id, wasHost);
    room.onmessage = (from, kind, data) => this.onMessage(from, kind, data);
  }

  // --- Roster ----------------------------------------------------------

  addPlayer(id, name, isLocal = false) {
    const player = {
      id,
      name: name || 'Piet',
      isLocal,
      present: true,
      slot: 0,
      colour: 0xd9d3c4,
      css: '#d9d3c4',
      role: 'survivor',
      // Where they are, as everybody else's browser last heard it.
      x: 0, z: 0, yaw: 0, gait: 'still',
      torch: false, hidden: false, sneak: false, offering: false,
      alive: true, down: false, dead: false, bleed: 0
    };
    this.players.set(id, player);
    this.reslot();
    return player;
  }

  // Slots decide the colour a player is tinted, and they have to agree on
  // every browser, so they are ordered by id rather than by who arrived first.
  reslot() {
    const ids = [...this.players.keys()].sort();
    ids.forEach((id, i) => {
      const player = this.players.get(id);
      const colour = crewColour(i);
      player.slot = i;
      player.colour = colour.hex;
      player.css = colour.css;
    });
  }

  local() {
    return this.players.get(this.localId);
  }

  crew() {
    return [...this.players.values()];
  }

  others() {
    return this.crew().filter(p => p.id !== this.localId);
  }

  survivors() {
    return this.crew().filter(p => p.role !== 'hunter' && p.present);
  }

  upright() {
    return this.survivors().filter(p => p.alive && !p.down);
  }

  isHunter(id = this.localId) {
    return this.mode === MODE.HUNT && this.hunterId === id;
  }

  playerCount() {
    return this.crew().filter(p => p.present).length;
  }

  // --- Lobby -----------------------------------------------------------

  onJoin(id, name) {
    if (!this.players.has(id)) this.addPlayer(id, name);
    else this.players.get(id).present = true;

    if (this.isHost) {
      // A joiner knows nothing yet: the roster, the mode and the ship all
      // come from here.
      this.broadcastLobby();
      if (this.phase === 'run') {
        // Somebody reconnecting into a run in progress is not supported; the
        // room is locked once it starts, so this cannot normally happen.
        this.room.send('shutrun', { why: 'the run had already started' }, { to: id });
      }
    }
    this.game.onCrewChanged();
  }

  onLeave(id, wasHost = false) {
    const player = this.players.get(id);
    if (!player) return;

    if (this.phase === 'lobby') {
      this.players.delete(id);
      this.reslot();
    } else {
      // Mid-run they leave a hole rather than vanishing from the arithmetic.
      player.present = false;
      player.alive = false;
      player.down = false;
      player.dead = true;
    }

    if (wasHost) {
      this.finish('hostgone');
      return;
    }
    if (this.isHost) {
      this.broadcastLobby();
      if (this.phase === 'run') {
        if (this.mode === MODE.HUNT && id === this.hunterId) {
          this.declare('offered', 'Mr. Geil left the boat');
          return;
        }
        // The rest of the crew hear it as a body taken, because from inside
        // the run that is what a tab closing looks like.
        this.room.send('gone', { id, why: 'left' });
        this.checkWipe();
      }
    }
    this.game.onCrewChanged();
  }

  setMode(mode) {
    if (!this.isHost || this.phase !== 'lobby') return;
    this.mode = mode === MODE.HUNT ? MODE.HUNT : MODE.COOP;
    this.assignHunter();
    this.broadcastLobby();
    this.game.onCrewChanged();
  }

  setHunter(id) {
    if (!this.isHost || this.phase !== 'lobby') return;
    if (!this.players.has(id)) return;
    this.hunterId = id;
    this.assignHunter();
    this.broadcastLobby();
    this.game.onCrewChanged();
  }

  assignHunter() {
    if (this.mode !== MODE.HUNT) {
      this.hunterId = null;
    } else if (!this.hunterId || !this.players.has(this.hunterId)) {
      // Whoever set the room up plays him first, which is nearly always what
      // the person who suggested the mode wanted.
      this.hunterId = this.localId;
    }
    for (const player of this.players.values()) {
      player.role = (this.mode === MODE.HUNT && player.id === this.hunterId)
        ? 'hunter' : 'survivor';
    }
  }

  lobbyState() {
    return {
      mode: this.mode,
      hunterId: this.hunterId,
      phase: this.phase,
      players: this.crew().map(p => ({ id: p.id, name: p.name, present: p.present }))
    };
  }

  broadcastLobby() {
    if (!this.isHost) return;
    this.room.send('lobby', this.lobbyState());
  }

  applyLobby(state) {
    const seen = new Set();
    for (const entry of state.players || []) {
      seen.add(entry.id);
      const player = this.players.get(entry.id) || this.addPlayer(entry.id, entry.name);
      player.name = entry.name;
      player.present = entry.present !== false;
    }
    // The host's roster is the roster. Anyone not on it has left.
    for (const id of [...this.players.keys()]) {
      if (!seen.has(id) && id !== this.localId) this.players.delete(id);
    }
    this.mode = state.mode === MODE.HUNT ? MODE.HUNT : MODE.COOP;
    this.hunterId = state.hunterId || null;
    for (const player of this.players.values()) {
      player.role = (this.mode === MODE.HUNT && player.id === this.hunterId)
        ? 'hunter' : 'survivor';
    }
    this.reslot();
    this.game.onCrewChanged();
  }

  // --- Starting --------------------------------------------------------

  // Host only. The seed is the whole ship, so it goes out before anything else
  // and every browser deals the same boat from it.
  startRun(seed) {
    if (!this.isHost || this.phase === 'run') return;
    this.assignHunter();
    this.seed = seed >>> 0;
    this.room.lock();

    const plan = {
      seed: this.seed,
      mode: this.mode,
      hunterId: this.hunterId,
      // Berths are handed out by slot, so nobody has to agree on anything
      // beyond the roster they already share.
      order: [...this.players.keys()].sort()
    };
    this.room.send('start', plan);
    this.beginRun(plan);
  }

  beginRun(plan) {
    this.seed = plan.seed >>> 0;
    this.mode = plan.mode === MODE.HUNT ? MODE.HUNT : MODE.COOP;
    this.hunterId = plan.hunterId || null;
    this.phase = 'run';
    this.outcome = null;
    this.tick = 0;
    this.snapTick = -1;
    this.sendTimer = 0;
    this.reviveTarget = null;
    this.reviveProgress = 0;
    this.finishProgress = 0;
    this.reuk = { strength: 0, dx: 0, dz: 1, timer: REUK_INTERVAL, name: null };

    const order = plan.order && plan.order.length ? plan.order : [...this.players.keys()].sort();
    order.forEach((id, i) => {
      const player = this.players.get(id);
      if (!player) return;
      player.berth = i;
      player.role = (this.mode === MODE.HUNT && id === this.hunterId) ? 'hunter' : 'survivor';
      player.alive = true;
      player.down = false;
      player.dead = false;
      player.bleed = 0;
      player.hidden = false;
      player.offering = false;
    });
    // Berths are dealt among the survivors, so a crew of three in the hunt is
    // not handed the gaps a fourth would have filled.
    let berth = 0;
    for (const id of order) {
      const player = this.players.get(id);
      if (!player || player.role === 'hunter') continue;
      player.berth = berth++;
    }
    this.reslot();

    this.game.beginNetRun(this);
    this.seatCrew();
  }

  // Put everybody on the roster where the run actually starts them.
  //
  // Every browser dealt the same ship from the same seed, so every browser
  // already knows every berth — none of it has to travel. Without this the
  // roster begins at the origin, and the origin is a real place on this ship:
  // the host would spend the first fifteenth of a second hunting a phantom
  // in the bow, and anybody stood near it would be caught by it.
  seatCrew() {
    if (typeof this.game.berthFor !== 'function') return;
    for (const player of this.players.values()) {
      const berth = this.game.berthFor(this, player);
      if (!berth) continue;
      player.x = berth.x;
      player.z = berth.z;
    }
  }

  // --- Traffic ---------------------------------------------------------

  onMessage(from, kind, data) {
    switch (kind) {
      case 'lobby':
        if (!this.isHost) this.applyLobby(data || {});
        break;

      case 'start':
        if (!this.isHost && data) this.beginRun(data);
        break;

      case 'frame':
        this.applyFrame(from, data);
        break;

      case 'snap':
        if (!this.isHost) this.applySnapshot(data);
        break;

      // A client finished tearing a pakje; the host rules on it and says so.
      case 'tear':
        if (this.isHost) this.openPresent(data && data.id, from);
        break;
      case 'opened':
        if (!this.isHost) this.applyOpen(data);
        break;

      case 'noise':
        if (this.isHost && data) this.game.world().enemy.hearNoiseAt(data.x, data.z, data.r || 1);
        break;

      case 'revive':
        if (this.isHost) this.doRevive(data && data.id, from);
        break;
      case 'finish':
        if (this.isHost) this.doFinish(data && data.id, from);
        break;

      case 'down': this.applyDown(data); break;
      case 'up': this.applyUp(data); break;
      case 'gone': this.applyGone(data); break;

      case 'end':
        if (!this.isHost && data) this.declareLocal(data.outcome, data.detail);
        break;

      case 'shutrun':
        this.finish('closed', data && data.why);
        break;
      default:
        break;
    }
  }

  // --- Per-frame -------------------------------------------------------

  update(delta) {
    if (this.phase !== 'run') return;

    const world = this.game.world();
    this.readLocal(world);

    if (this.isHost) this.hostStep(delta, world);
    this.interactions(delta, world);
    if (this.isHunter()) this.updateReuk(delta, world);

    this.sendTimer -= delta;
    if (this.sendTimer <= 0) {
      this.sendTimer = 1 / SEND_HZ;
      this.tick++;
      if (this.isHost) this.sendSnapshot(world);
      else this.sendFrame(world);
    }
  }

  // Fold this browser's own player into the roster, so the host's arithmetic
  // and everybody else's drawing read from one place.
  readLocal(world) {
    const me = this.local();
    if (!me) return;
    const player = world.player;
    // A downed body does not walk, and neither does the camera above it.
    if (!me.down && !me.dead) {
      me.x = player.x;
      me.z = player.z;
      me.yaw = player.yaw;
      me.gait = player.gait;
      me.torch = player.flashlightOn;
      me.hidden = player.isHidden;
      me.sneak = !!player.keys.sneak;
    } else {
      me.gait = 'still';
      me.torch = false;
      me.hidden = false;
    }
  }

  // --- Host: the world ---------------------------------------------------

  hostStep(delta, world) {
    const enemy = world.enemy;

    if (this.mode === MODE.HUNT) {
      const hunter = this.players.get(this.hunterId);
      if (hunter && hunter.present) {
        enemy.applyRemote({
          x: hunter.x,
          z: hunter.z,
          // A player's yaw looks down -Z; his facing is measured from +Z.
          facing: Math.atan2(-Math.sin(hunter.yaw), -Math.cos(hunter.yaw)),
          state: hunter.gait === 'sprint' ? STATE.CHASE : STATE.SEARCH
        });
      }
    }

    // Nobody upright is nobody coming.
    const abandoned = this.upright().length === 0;
    for (const player of this.survivors()) {
      if (!player.down || player.dead) continue;
      player.bleed -= delta * (abandoned ? ABANDONED_BLEED : 1);
      if (player.bleed <= 0) this.doDeath(player, 'bled');
    }
  }

  // Who Mr. Geil is allowed to be looking for. A body on the deck is not one
  // of them; whoever is knelt over it is.
  huntTargets(world) {
    const targets = [];
    for (const player of this.survivors()) {
      if (!player.present) continue;
      targets.push(player.isLocal ? bindLocal(world.player, player) : bindRemote(player));
    }
    return targets;
  }

  onCatch(target, world) {
    if (!this.isHost) return;
    const player = this.players.get(target.netId);
    if (!player || !player.alive || player.down) return;

    // Nobody left to come and get you is not a rescue, it is a long wait.
    const rescuers = this.upright().filter(p => p.id !== player.id).length;
    if (rescuers === 0) {
      this.doDeath(player, 'taken');
      return;
    }

    player.down = true;
    player.bleed = BLEED_SECONDS;
    this.room.send('down', { id: player.id });
    this.applyDown({ id: player.id }, true);

    // The AI has what it came for and loses interest for a moment. A person
    // playing him gets to decide that for themselves.
    if (this.mode === MODE.COOP) world.enemy.sate(SATE_SECONDS);
  }

  checkWipe() {
    if (!this.isHost || this.phase !== 'run') return;
    const standing = this.survivors().filter(p => p.present && !p.dead);
    if (standing.length === 0) this.declare('taken');
  }

  // --- Host: rulings ----------------------------------------------------

  openPresent(id, openerId) {
    if (!this.isHost || this.phase !== 'run') return;
    const world = this.game.world();
    const present = world.items.byId(id);
    if (!present || present.isUnwrapped) return;
    const payload = { id, by: openerId };
    this.room.send('opened', payload);
    this.applyOpen(payload);
  }

  applyOpen(data) {
    if (!data) return;
    const world = this.game.world();
    world.items.unwrapById(data.id, data.by);
  }

  doRevive(id, byId) {
    if (!this.isHost) return;
    const player = this.players.get(id);
    const helper = this.players.get(byId);
    if (!player || !player.down || player.dead) return;
    if (!helper || !helper.alive || helper.down || helper.role === 'hunter') return;
    if (Math.hypot(helper.x - player.x, helper.z - player.z) > REVIVE_RANGE * 1.6) return;

    this.room.send('up', { id });
    this.applyUp({ id });
  }

  doFinish(id, byId) {
    if (!this.isHost) return;
    if (this.mode !== MODE.HUNT || byId !== this.hunterId) return;
    const player = this.players.get(id);
    if (!player || !player.down || player.dead) return;
    this.doDeath(player, 'finished');
  }

  doDeath(player, why) {
    player.down = false;
    player.dead = true;
    player.alive = false;
    this.room.send('gone', { id: player.id, why });
    this.applyGone({ id: player.id, why });
    this.checkWipe();
  }

  // The offering is made. Host only: the altar is the run's ending and two
  // browsers must not both get to declare it.
  onOffered() {
    if (!this.isHost || this.phase !== 'run') return;
    this.declare('offered');
  }

  declare(outcome, detail = null) {
    if (!this.isHost || this.phase !== 'run') return;
    this.room.send('end', { outcome, detail });
    this.declareLocal(outcome, detail);
  }

  declareLocal(outcome, detail) {
    if (this.phase !== 'run') return;
    this.phase = 'over';
    this.outcome = outcome;
    this.room.unlock();
    this.game.endNetRun(outcome, detail);
  }

  // The room fell apart under us.
  finish(reason, detail) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.outcome = reason;
    this.game.endNetRun(reason, detail);
  }

  // Back to the lobby with the same room.
  backToLobby() {
    this.phase = 'lobby';
    this.outcome = null;
    this.room.unlock();
    // Anybody who walked off mid-run is not on the next one.
    for (const [id, player] of [...this.players]) {
      if (!player.present && id !== this.localId) this.players.delete(id);
    }
    this.reslot();
    for (const player of this.players.values()) {
      player.alive = true;
      player.down = false;
      player.dead = false;
      player.bleed = 0;
    }
    if (this.isHost) this.broadcastLobby();
    this.game.onCrewChanged();
  }

  // --- Events applied everywhere ---------------------------------------

  applyDown(data, local = false) {
    const player = data && this.players.get(data.id);
    if (!player || player.dead) return;
    player.down = true;
    if (!local) player.bleed = BLEED_SECONDS;
    this.game.onCrewEvent('down', player);
  }

  applyUp(data) {
    const player = data && this.players.get(data.id);
    if (!player) return;
    player.down = false;
    player.dead = false;
    player.alive = true;
    player.bleed = 0;
    this.game.onCrewEvent('up', player);
  }

  applyGone(data) {
    const player = data && this.players.get(data.id);
    if (!player || player.dead) return;
    player.down = false;
    player.dead = true;
    player.alive = false;
    this.game.onCrewEvent('gone', player);
  }

  // --- Interaction: hauling people up, and finishing them ----------------

  interactions(delta, world) {
    const me = this.local();
    this.reviveTarget = null;

    if (!me || me.dead || me.down || this.phase !== 'run') {
      this.reviveProgress = 0;
      this.finishProgress = 0;
      return;
    }

    const held = world.player.interactHeld;
    const hunting = this.isHunter();
    const range = hunting ? FINISH_RANGE : REVIVE_RANGE;
    const seconds = hunting ? FINISH_SECONDS : REVIVE_SECONDS;

    let nearest = null;
    let nearestDist = range;
    for (const player of this.survivors()) {
      if (player.id === this.localId || !player.down || player.dead) continue;
      const d = Math.hypot(player.x - me.x, player.z - me.z);
      if (d < nearestDist) {
        nearest = player;
        nearestDist = d;
      }
    }
    this.reviveTarget = nearest;

    const key = hunting ? 'finishProgress' : 'reviveProgress';
    const other = hunting ? 'reviveProgress' : 'finishProgress';
    this[other] = 0;

    if (nearest && held) {
      this[key] += delta / seconds;
      if (this[key] >= 1) {
        this[key] = 0;
        if (hunting) {
          if (this.isHost) this.doFinish(nearest.id, this.localId);
          else this.room.send('finish', { id: nearest.id });
        } else if (this.isHost) {
          this.doRevive(nearest.id, this.localId);
        } else {
          this.room.send('revive', { id: nearest.id });
        }
      }
    } else {
      // Bleed it away rather than dropping it, the same as tearing a pakje.
      this[key] = Math.max(0, this[key] - delta * 1.6);
    }
  }

  // --- The hunter's sense ----------------------------------------------

  // A person playing Mr. Geil has no torch and no lantern. What they have is
  // this: every few seconds, the direction of whoever is making the most noise
  // — which is exactly what the AI hears, turned into something a person can
  // act on. Stand still and it finds nobody. Sprint and it finds you across
  // the ship.
  updateReuk(delta, world) {
    this.reuk.timer -= delta;
    if (this.reuk.timer > 0) {
      // Fade between pulses, so the reading is a moment and not a tracker.
      this.reuk.strength = Math.max(0, this.reuk.strength - delta * 0.42);
      return;
    }
    this.reuk.timer = REUK_INTERVAL;

    const me = this.local();
    let best = null;
    for (const player of this.survivors()) {
      if (!player.present || player.dead || player.down) continue;
      const carry = REUK_RANGE[player.hidden ? 'still' : player.gait] || 0;
      if (carry <= 0) continue;
      const dist = Math.hypot(player.x - me.x, player.z - me.z);
      if (dist > carry) continue;
      const strength = 1 - dist / carry;
      if (!best || strength > best.strength) best = { player, dist, strength };
    }

    if (!best) {
      this.reuk.strength = 0;
      this.reuk.name = null;
      return;
    }

    // A faint reading is a vague direction. A loud one is nearly exact.
    const slop = (1 - best.strength) * 1.5;
    const toX = best.player.x - me.x;
    const toZ = best.player.z - me.z;
    const bearing = Math.atan2(toX, toZ) + (Math.random() - 0.5) * slop;
    this.reuk.dx = Math.sin(bearing);
    this.reuk.dz = Math.cos(bearing);
    this.reuk.strength = best.strength;
    this.reuk.name = best.player.name;
    this.game.onReuk(this.reuk);
  }

  // --- Wire format ------------------------------------------------------

  frameFor(player, world) {
    let flags = 0;
    if (player.torch) flags |= F_TORCH;
    if (player.hidden) flags |= F_HIDDEN;
    if (player.sneak) flags |= F_SNEAK;
    if (player.down) flags |= F_DOWN;
    if (player.dead) flags |= F_DEAD;
    if (player.offering) flags |= F_OFFERING;
    return {
      i: player.id,
      x: r2(player.x), z: r2(player.z), y: r2(player.yaw),
      g: Math.max(0, GAITS.indexOf(player.gait)),
      f: flags
    };
  }

  readFrame(player, frame) {
    if (!frame) return;
    player.x = frame.x;
    player.z = frame.z;
    player.yaw = frame.y;
    player.gait = GAITS[frame.g] || 'still';
    player.torch = !!(frame.f & F_TORCH);
    player.hidden = !!(frame.f & F_HIDDEN);
    player.sneak = !!(frame.f & F_SNEAK);
    player.offering = !!(frame.f & F_OFFERING);
    // Down and dead are settled by the host through their own events; a frame
    // never gets to promote or demote a body.
  }

  // A client's own body, on its way to the host.
  sendFrame(world) {
    const me = this.local();
    if (!me) return;
    me.offering = this.localOffering(world);
    this.room.send('frame', this.frameFor(me, world), {
      to: this.room.hostId, reliable: false
    });
  }

  applyFrame(from, frame) {
    const player = this.players.get(from);
    if (!player || player.isLocal) return;
    this.readFrame(player, frame);
    // Clients hear about each other through the host's snapshot; the host
    // hears about them directly, and pushes them into the world here.
    if (this.isHost) this.game.onCrewFrame(player);
  }

  // Somebody who is not this browser is holding the offering down. The host
  // reads it off the crew's frames; everybody else is told the progress
  // outright and does not need to know who.
  remoteOffering() {
    if (!this.isHost || this.phase !== 'run') return false;
    return this.others().some(p => p.offering && p.present && !p.down && !p.dead);
  }

  // The local player has finished tearing a pakje. Only the host says whether
  // it counts, so this asks rather than opens. See items.js: announceOnly.
  requestTear(id) {
    if (this.phase !== 'run') return;
    if (this.isHost) this.openPresent(id, this.localId);
    else this.room.send('tear', { id });
  }

  localOffering(world) {
    const me = this.local();
    if (!me || me.down || me.dead || this.isHunter()) return false;
    return world.player.interactHeld &&
      world.items.isReadyForTribute() &&
      world.altar.isInRange(world.player.getPosition()) &&
      !world.altar.isOffered;
  }

  sendSnapshot(world) {
    const me = this.local();
    if (me) me.offering = this.localOffering(world);

    const snapshot = {
      n: this.tick,
      e: world.enemy.netState(),
      c: this.crew().filter(p => p.present).map(p => this.frameFor(p, world)),
      k: world.items.collectedCount,
      a: r2(world.altar.progress),
      d: this.crew().filter(p => p.down || p.dead)
        .map(p => ({ i: p.id, b: Math.round(p.bleed), x: p.dead ? 1 : 0 }))
    };
    this.room.send('snap', snapshot, { reliable: false });
  }

  applySnapshot(snapshot) {
    if (!snapshot || this.phase !== 'run') return;
    // Snapshots are unreliable and unordered: an old one arriving after a new
    // one would drag everybody backwards.
    if (snapshot.n <= this.snapTick) return;
    this.snapTick = snapshot.n;

    const world = this.game.world();
    world.enemy.applyRemote({
      x: snapshot.e.x, z: snapshot.e.z, facing: snapshot.e.f,
      state: snapshot.e.s, awareness: snapshot.e.a, tier: snapshot.e.t
    });

    for (const frame of snapshot.c || []) {
      const player = this.players.get(frame.i);
      if (!player || player.isLocal) continue;
      this.readFrame(player, frame);
      this.game.onCrewFrame(player);
    }

    for (const entry of snapshot.d || []) {
      const player = this.players.get(entry.i);
      if (player) player.bleed = entry.b;
    }

    world.altar.syncProgress(snapshot.a, world.items);
  }
}

// The host's copy of Mr. Geil reads the crew through these: one shape whether
// the body behind it is this browser's own player or a set of numbers off the
// wire. `netHunted` is what takes a downed body out of his attention.
function bindLocal(player, entry) {
  player.netId = entry.id;
  player.netHunted = entry.alive && !entry.down && !entry.dead && entry.present;
  return player;
}

function bindRemote(entry) {
  if (!entry.proxy) {
    entry.proxy = {
      netId: entry.id,
      keys: { sneak: false },
      isHidden: false,
      flashlightOn: false,
      x: 0, z: 0,
      getNoiseRadius() { return this.noise; },
      getVisibilityFactor() {
        if (this.isHidden) return 0;
        let factor = 1;
        if (this.flashlightOn) factor *= 1.85;
        if (this.keys.sneak) factor *= 0.55;
        else if (this.gait === 'sprint') factor *= 1.25;
        return factor;
      },
      getForward() {
        return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
      }
    };
  }
  const proxy = entry.proxy;
  proxy.x = entry.x;
  proxy.z = entry.z;
  proxy.yaw = entry.yaw;
  proxy.gait = entry.gait;
  proxy.keys.sneak = entry.sneak;
  proxy.isHidden = entry.hidden;
  proxy.flashlightOn = entry.torch;
  // The same table player.js carries, because it is the same rule: a crewmate
  // across the ship has to be as loud to him as you are.
  proxy.noise = entry.hidden ? 0
    : entry.gait === 'sprint' ? 26
      : entry.gait === 'walk' ? 13
        : entry.gait === 'sneak' ? 3.5 : 0;
  proxy.netHunted = entry.alive && !entry.down && !entry.dead && entry.present;
  return proxy;
}

function r2(v) {
  return Math.round(v * 100) / 100;
}
