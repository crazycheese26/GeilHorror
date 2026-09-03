// Mr. Geil.
//
// He does not know where you are. He builds a belief about you out of two
// senses and one memory:
//   sight   - a forward cone, blocked by bulkheads, scaled by your flashlight
//             and your gait
//   hearing - a radius around every footstep, halved through walls
//   memory  - your last known position, which he walks to and searches
//
// That loop is the whole game: break his line of sight, go quiet, and he
// loses you. Sprint past him with your torch on and he will not.

import { TextureFactory } from './textures.js';
import { horrorAudio } from './audio.js';

export const STATE = {
  PATROL: 'PATROL',
  SUSPICIOUS: 'SUSPICIOUS',
  SEARCH: 'SEARCH',
  CHASE: 'CHASE',
  PACIFIED: 'PACIFIED'
};

// Where he stands before a run is planned. A seeded layout overwrites both
// this and his patrol circuit (see layout.js).
const DEFAULT_SPAWN_CELL = { c: 9, r: 17 };

// How often he wanders off his circuit. Enough that the route is worth
// learning, not so much that it is a timetable you can set a watch by.
const DETOUR_CHANCE = 0.25;

export class GeilEnemy {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;

    this.width = 3.2;
    this.height = 1.66;

    this.spawn = {
      x: DEFAULT_SPAWN_CELL.c * map.cellSize,
      z: DEFAULT_SPAWN_CELL.r * map.cellSize
    };
    this.patrolRoute = [];
    this.routeIndex = 0;

    this.x = this.spawn.x;
    this.z = this.spawn.z;
    this.y = this.height / 2 + 0.05;
    this.facing = 0;

    this.state = STATE.PATROL;
    this.awareness = 0;
    this.distToPlayer = Infinity;
    this.hasLos = false;
    this.tier = 0;              // rises with every pillow collected
    this.isDeadly = true;

    this.poi = null;            // point of interest he is walking to
    this.lastKnown = null;
    this.searchQueue = [];
    this.searchTimer = 0;
    this.lostTimer = 0;
    this.lookAroundTimer = 0;
    this.repathTimer = 0;
    this.cachedStep = null;
    this.growlTimer = 3;
    this.stepTimer = 0;
    this.scentTimer = 10;
    this.litAmount = 0;
    this.justDetected = false;

    this.build();
    this.pickPatrolTarget();
  }

  // --- Presentation ----------------------------------------------------

  build() {
    const geo = new THREE.PlaneGeometry(this.width, this.height);
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      color: 0x2a2a2a,
      fog: true
    });

    this.sprite = new THREE.Mesh(geo, this.material);
    this.sprite.position.set(this.x, this.y, this.z);
    this.sprite.renderOrder = 2;
    this.scene.add(this.sprite);

    // Contact shadow, so he is standing on the deck rather than hovering.
    const shadowTex = TextureFactory.createBlobShadow();
    const shadowGeo = new THREE.PlaneGeometry(this.width * 0.85, this.width * 0.42);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex, transparent: true, depthWrite: false, opacity: 0.7
    });
    this.shadow = new THREE.Mesh(shadowGeo, this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(this.x, 0.03, this.z);
    this.scene.add(this.shadow);

    this.glow = new THREE.PointLight(0x772222, 0.0, 9, 2.0);
    this.glow.position.set(this.x, 1.2, this.z);
    this.scene.add(this.glow);

    this.disposables = [geo, this.material, shadowTex, shadowGeo, this.shadowMat];

    this.loadSketch();
  }

  // Strip the paper out of the sketch so only the ink survives.
  loadSketch() {
    const img = new Image();
    img.onload = () => {
      try {
        this.material.map = TextureFactory.keyOutPaper(img, [236, 231, 218]);
        this.material.color.setHex(0xffffff);
        this.material.needsUpdate = true;
        this.disposables.push(this.material.map);
      } catch (err) {
        // Canvas is tainted (opened over file://). Fall back to the raw image.
        console.warn('Could not key the sketch, using it as-is:', err);
        const tex = new THREE.Texture(img);
        tex.needsUpdate = true;
        this.material.map = tex;
        this.material.color.setHex(0xffffff);
        this.material.needsUpdate = true;
        this.disposables.push(tex);
      }
    };
    img.onerror = () => console.warn('assets/geil_original.png failed to load');
    img.src = 'assets/geil_original.png';
  }

  // --- Perception ------------------------------------------------------

  sightRange(player) {
    return (12.5 + this.tier * 1.1) * player.getVisibilityFactor();
  }

  // Returns a 0..1 strength for how strongly he can see the player right now.
  seeStrength(player, dist) {
    const range = this.sightRange(player);
    if (range <= 0 || dist > range) return 0;

    // Wider awareness once he is already alert.
    const alert = this.state === STATE.CHASE || this.state === STATE.SEARCH;
    const halfCone = alert ? 1.40 : 1.05; // ~80 deg vs ~60 deg
    const toX = player.x - this.x;
    const toZ = player.z - this.z;
    const angle = Math.abs(angleDelta(Math.atan2(toX, toZ), this.facing));

    // Anything practically on top of him is seen regardless of facing.
    let cone;
    if (dist < 2.5) cone = 1;
    else if (angle > halfCone) return 0;
    else cone = 1 - (angle / halfCone) * 0.55;

    if (!this.map.hasLineOfSight(this.x, this.z, player.x, player.z, player.keys.sneak)) {
      return 0;
    }
    return cone * (1 - (dist / range) * 0.7);
  }

  hearStrength(player, dist) {
    let radius = player.getNoiseRadius();
    if (radius <= 0) return 0;
    if (!this.map.hasLineOfSight(this.x, this.z, player.x, player.z)) radius *= 0.55;
    if (dist > radius) return 0;
    return 1 - dist / radius;
  }

  // --- Main loop -------------------------------------------------------

  update(delta, player, onCatch) {
    if (this.state === STATE.PACIFIED) {
      this.updateVisual(delta, player, 0);
      return;
    }

    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const dist = Math.hypot(dx, dz);
    this.distToPlayer = dist;
    this.justDetected = false;

    const see = this.seeStrength(player, dist);
    const hear = this.hearStrength(player, dist);
    this.hasLos = see > 0;

    this.updateAwareness(delta, player, see, hear, dist);
    this.updateState(delta, player, see, hear, dist);
    this.updateMovement(delta, player);
    this.updateAudio(delta, dist);
    this.updateVisual(delta, player, dist);

    if (this.checkCaught(player, dist)) {
      if (onCatch) onCatch();
    }
  }

  updateAwareness(delta, player, see, hear, dist) {
    const gainScale = 1 + this.tier * 0.09;

    if (see > 0) {
      this.awareness += (0.75 + 2.3 * see) * gainScale * delta;
      this.lastKnown = { x: player.x, z: player.z };
      this.lostTimer = 0;
    } else if (hear > 0) {
      // Sound tells him roughly where, not exactly. Loud noise, better fix.
      const slop = (1 - hear) * 3.5;
      this.lastKnown = {
        x: player.x + (Math.random() - 0.5) * slop,
        z: player.z + (Math.random() - 0.5) * slop
      };
      this.awareness = Math.max(this.awareness, hear > 0.6 ? 0.8 : 0.45);
      this.awareness += hear * 0.7 * gainScale * delta;
      this.lostTimer = 0;
    } else {
      this.lostTimer += delta;
      // Decay stalls briefly after losing you, so he does not shrug it off.
      const decay = this.lostTimer < 1.5 ? 0.12 : 0.42;
      this.awareness -= decay * delta;
    }

    this.awareness = Math.max(0, Math.min(1, this.awareness));
  }

  updateState(delta, player, see, hear, dist) {
    // Once every pillow is gathered he is drawn toward your part of the ship.
    if (this.tier >= 5 && this.state !== STATE.CHASE) {
      this.scentTimer -= delta;
      if (this.scentTimer <= 0) {
        this.scentTimer = 11;
        this.lastKnown = { x: player.x, z: player.z };
        this.enterState(STATE.SEARCH, player);
      }
    }

    switch (this.state) {
      case STATE.PATROL:
        if (this.awareness >= 1) this.enterState(STATE.CHASE, player);
        else if (this.awareness >= 0.3 && this.lastKnown) this.enterState(STATE.SUSPICIOUS, player);
        else this.patrolStep(delta);
        break;

      case STATE.SUSPICIOUS:
        if (this.awareness >= 1) { this.enterState(STATE.CHASE, player); break; }
        if (this.awareness <= 0.05) { this.enterState(STATE.PATROL, player); break; }
        this.poi = this.lastKnown;
        if (this.poi && this.reached(this.poi, 1.6)) {
          this.lookAroundTimer -= delta;
          if (this.lookAroundTimer <= 0) this.enterState(STATE.SEARCH, player);
          else this.facing += delta * 1.5;
        }
        break;

      case STATE.CHASE:
        // He runs at where he last had you, not at where you actually are.
        this.poi = this.lastKnown || { x: player.x, z: player.z };
        if (see <= 0 && hear <= 0) {
          if (this.lostTimer > 2.2) this.enterState(STATE.SEARCH, player);
        }
        break;

      case STATE.SEARCH:
        if (this.awareness >= 1) { this.enterState(STATE.CHASE, player); break; }
        // A sweep has to end, or the player never gets the moment where the
        // pressure lifts and it is safe to move again.
        this.searchTimer -= delta;
        if (this.searchTimer <= 0) { this.enterState(STATE.PATROL, player); break; }
        if (!this.poi || this.reached(this.poi, 1.8)) {
          this.lookAroundTimer -= delta;
          this.facing += delta * 2.2;
          if (this.lookAroundTimer <= 0) {
            this.poi = this.searchQueue.shift() || null;
            this.lookAroundTimer = 1.4;
            this.repathTimer = 0;
            if (!this.poi) this.enterState(STATE.PATROL, player);
          }
        }
        break;
    }
  }

  enterState(next, player) {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    this.repathTimer = 0;
    this.cachedStep = null;

    if (next === STATE.CHASE) {
      this.poi = { x: player.x, z: player.z };
      if (prev !== STATE.CHASE) this.justDetected = true;
      horrorAudio.playDetected();
      // The line-of-sight sting, over the top of whatever bed is running.
      horrorAudio.playSightingStinger();
    } else if (next === STATE.SUSPICIOUS) {
      this.poi = this.lastKnown;
      this.lookAroundTimer = 1.8;
      horrorAudio.playAlerted();
    } else if (next === STATE.SEARCH) {
      this.buildSearchQueue();
      this.poi = this.searchQueue.shift() || this.lastKnown;
      this.lookAroundTimer = 1.4;
      this.searchTimer = 16 + Math.random() * 6;
    } else if (next === STATE.PATROL) {
      this.awareness = Math.min(this.awareness, 0.2);
      this.lastKnown = null;
      this.resumeRouteNearby();
      this.pickPatrolTarget();
    }
  }

  // He sweeps the last known position, then the cover near it. Hiding in a
  // cargo stack he watched you run to will not save you.
  buildSearchQueue() {
    const origin = this.lastKnown || { x: this.x, z: this.z };
    const queue = [{ x: origin.x, z: origin.z }];

    const nearbyCover = this.map.hidingSpots
      .map(s => ({ s, d: Math.hypot(s.x - origin.x, s.z - origin.z) }))
      .filter(e => e.d < 11)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
      .map(e => ({ x: e.s.x, z: e.s.z }));
    queue.push(...nearbyCover);

    for (let i = 0; i < 2; i++) {
      const tile = this.map.getRandomTileFrom(origin.x, origin.z, 3);
      if (Math.hypot(tile.x - origin.x, tile.z - origin.z) < 14) {
        queue.push({ x: tile.x, z: tile.z });
      }
    }

    this.searchQueue = queue;
  }

  patrolStep(delta) {
    if (!this.poi || this.reached(this.poi, 1.8)) {
      this.lookAroundTimer -= delta;
      this.facing += delta * 1.1;
      if (this.lookAroundTimer <= 0) this.pickPatrolTarget();
    }
  }

  pickPatrolTarget() {
    // Long legs and a short pause: he should read as pacing the ship, not
    // loitering. Short waypoints plus long look-arounds leave him standing
    // still for a third of the time, which makes the boat feel empty.
    const tile = this.nextPatrolTile();
    this.poi = { x: tile.x, z: tile.z };
    this.lookAroundTimer = 0.9 + Math.random() * 1.1;
    this.repathTimer = 0;
    this.cachedStep = null;
  }

  // He walks this run's circuit, with the odd detour. A route the player can
  // learn is the point: it turns hiding into timing rather than luck.
  nextPatrolTile() {
    if (!this.patrolRoute.length || Math.random() < DETOUR_CHANCE) {
      return this.map.getRandomTileFrom(this.x, this.z, 16);
    }
    const tile = this.patrolRoute[this.routeIndex % this.patrolRoute.length];
    this.routeIndex = (this.routeIndex + 1) % this.patrolRoute.length;
    return tile;
  }

  // Coming off a search he is nowhere near where he left the circuit, so he
  // rejoins it at the leg after the nearest waypoint instead of doubling back.
  resumeRouteNearby() {
    if (!this.patrolRoute.length) return;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.patrolRoute.length; i++) {
      const w = this.patrolRoute[i];
      const d = Math.hypot(w.x - this.x, w.z - this.z);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    this.routeIndex = (best + 1) % this.patrolRoute.length;
  }

  // --- Run plan --------------------------------------------------------

  applyRunLayout(layout) {
    if (!layout) return;
    if (layout.enemySpawn) {
      this.spawn = { x: layout.enemySpawn.x, z: layout.enemySpawn.z };
    }
    this.patrolRoute = (layout.patrolRoute || []).map(w => ({ x: w.x, z: w.z }));
    this.routeIndex = 0;
  }

  reached(point, radius) {
    return Math.hypot(point.x - this.x, point.z - this.z) < radius;
  }

  currentSpeed() {
    switch (this.state) {
      case STATE.CHASE: return 4.9 + this.tier * 0.16;
      case STATE.SEARCH: return 3.1 + this.tier * 0.10;
      case STATE.SUSPICIOUS: return 3.0 + this.tier * 0.10;
      default: return 2.1 + this.tier * 0.08;
    }
  }

  updateMovement(delta, player) {
    if (!this.poi) return;

    // Chasing means running straight at a visible target; otherwise follow the
    // corridor graph. Repathing is throttled: BFS every frame is wasteful.
    this.repathTimer -= delta;
    if (this.repathTimer <= 0 || !this.cachedStep) {
      this.repathTimer = 0.3;
      if (this.state === STATE.CHASE && this.hasLos && this.distToPlayer < 9) {
        this.cachedStep = { x: this.poi.x, z: this.poi.z };
      } else {
        this.cachedStep = this.map.findPathNextStep(this.x, this.z, this.poi.x, this.poi.z);
        // Unreachable target: drop it and move on rather than grinding.
        if (!this.cachedStep) {
          this.poi = null;
          if (this.state === STATE.PATROL) this.pickPatrolTarget();
          else this.poi = this.searchQueue.shift() || null;
          return;
        }
      }
    }

    const toX = this.cachedStep.x - this.x;
    const toZ = this.cachedStep.z - this.z;
    const dist = Math.hypot(toX, toZ);
    if (dist < 0.08) {
      this.cachedStep = null;
      return;
    }

    const speed = this.currentSpeed();
    const stepLen = Math.min(speed * delta, dist);
    const nx = this.x + (toX / dist) * stepLen;
    const nz = this.z + (toZ / dist) * stepLen;

    const resolved = this.map.resolveCollision(this.x, this.z, nx, nz, 0.5);
    const moved = Math.hypot(resolved.x - this.x, resolved.z - this.z);
    this.x = resolved.x;
    this.z = resolved.z;

    // Wedged against geometry: force a fresh path next tick.
    if (moved < stepLen * 0.2) this.cachedStep = null;

    if (moved > 0.0005) {
      const targetFacing = Math.atan2(toX, toZ);
      this.facing += angleDelta(targetFacing, this.facing) * Math.min(1, delta * 6);
    }
  }

  updateAudio(delta, dist) {
    // Heartbeat tracks how much danger he actually represents, not raw range.
    const proximity = Math.max(0, 1 - dist / 24);
    const threat = Math.max(this.awareness * 0.85, proximity * 0.7);
    horrorAudio.setThreat(this.state === STATE.CHASE ? Math.max(threat, 0.85) : threat);

    // Audible footsteps are how a player tracks him without seeing him.
    if (dist < 26) {
      this.stepTimer -= delta;
      if (this.stepTimer <= 0) {
        const speed = this.currentSpeed();
        this.stepTimer = 1.5 / Math.max(1, speed);
        horrorAudio.playGeilStep(dist, this.state === STATE.CHASE);
      }
    }

    this.growlTimer -= delta;
    if (this.growlTimer <= 0 && dist < 22) {
      this.growlTimer = 4 + Math.random() * 6;
      horrorAudio.playMonsterGrowl(Math.max(0.15, 1 - dist / 22));
    }
  }

  updateVisual(delta, player, dist) {
    const t = performance.now() / 1000;
    const chasing = this.state === STATE.CHASE;

    // Lurch: faster and heavier the more urgent his state.
    const gaitRate = chasing ? 9.5 : this.state === STATE.PATROL ? 3.2 : 5.5;
    const bob = Math.abs(Math.sin(t * gaitRate)) * (chasing ? 0.16 : 0.07);
    const lean = Math.sin(t * gaitRate * 0.5) * (chasing ? 0.10 : 0.05);
    const swell = chasing ? 1.12 : 1.0;

    this.sprite.position.set(this.x, this.y + bob, this.z);
    // Yaw-only billboard: he stays upright instead of tipping toward the eye.
    this.sprite.rotation.set(0, Math.atan2(player.x - this.x, player.z - this.z), lean);
    this.sprite.scale.set(swell, swell, 1);

    this.shadow.position.set(this.x, 0.03, this.z);
    this.shadowMat.opacity = 0.55 - bob * 1.2;

    // He is a dim shape in the dark and resolves only inside your beam.
    const inBeam = this.isInFlashlight(player, dist);
    const targetLit = inBeam ? 1.0 : 0.17;
    this.litAmount += (targetLit - this.litAmount) * Math.min(1, delta * 7);
    const v = 0.10 + this.litAmount * 0.90;
    // Chasing tints him toward blood.
    this.material.color.setRGB(v, v * (chasing ? 0.62 : 0.97), v * (chasing ? 0.58 : 0.94));

    this.glow.position.set(this.x, 1.2, this.z);
    this.glow.intensity = chasing ? 1.5 + Math.sin(t * 9) * 0.35 : 0;
  }

  isInFlashlight(player, dist) {
    if (!player.flashlightOn || dist > 30) return false;
    const fwd = player.getForward();
    const toX = this.x - player.x;
    const toZ = this.z - player.z;
    const len = Math.hypot(toX, toZ) || 1;
    const dot = (fwd.x * toX + fwd.z * toZ) / len;
    if (dot < 0.80) return false; // roughly the beam's half-angle
    return this.map.hasLineOfSight(player.x, player.z, this.x, this.z);
  }

  checkCaught(player, dist) {
    if (!this.isDeadly) return false;

    if (player.isHidden) {
      // Cover works, unless he is actively sweeping and reaches your stack.
      const hunting = this.state === STATE.CHASE || this.state === STATE.SEARCH;
      return hunting && dist < 1.9;
    }
    return dist < 1.5;
  }

  // --- External events -------------------------------------------------

  // A loud one-off sound anywhere on the ship: he investigates.
  hearNoiseAt(x, z, strength = 1) {
    if (this.state === STATE.PACIFIED) return;
    const dist = Math.hypot(x - this.x, z - this.z);
    if (dist > 34 * strength) return;
    this.lastKnown = { x, z };
    this.awareness = Math.max(this.awareness, 0.65);
    if (this.state === STATE.PATROL) this.enterState(STATE.SUSPICIOUS, { x, z });
  }

  setTier(tier) {
    this.tier = tier;
  }

  pacify() {
    this.state = STATE.PACIFIED;
    this.isDeadly = false;
    this.awareness = 0;
    this.glow.color.setHex(0xffcc66);
    this.glow.intensity = 3.0;
    this.material.color.setRGB(1, 1, 1);
    horrorAudio.setThreat(0);
  }

  reset() {
    this.x = this.spawn.x;
    this.z = this.spawn.z;
    this.facing = 0;
    this.routeIndex = 0;
    this.state = STATE.PATROL;
    this.awareness = 0;
    this.tier = 0;
    this.isDeadly = true;
    this.lastKnown = null;
    this.searchQueue = [];
    this.searchTimer = 0;
    this.lostTimer = 0;
    this.scentTimer = 10;
    this.cachedStep = null;
    this.litAmount = 0;
    this.glow.color.setHex(0x772222);
    this.glow.intensity = 0;
    this.material.color.setRGB(0.1, 0.1, 0.1);
    this.pickPatrolTarget();
  }

  dispose() {
    this.scene.remove(this.sprite, this.shadow, this.glow);
    for (const item of this.disposables) {
      if (item && typeof item.dispose === 'function') item.dispose();
    }
  }
}

// Shortest signed angle from b to a, in (-PI, PI].
function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
