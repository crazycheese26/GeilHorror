// The stoomboot: corridor layout, geometry, lighting, and the spatial queries
// the stealth AI runs against (line of sight, pathfinding, cover).

import { TextureFactory } from './textures.js';

// Cell values: 1 wall, 0 corridor, 2 cargo stack (waist-high cover),
// 'S' player start, 'P' present spawn, 'A' shrine floor.
const LAYOUT = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 'S', 0, 0, 1, 'P', 0, 0, 0, 1, 0, 2, 0, 'P', 1, 0, 0, 2, 0, 'P', 1],
  [1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1],
  [1, 0, 2, 0, 1, 0, 0, 0, 1, 'P', 1, 0, 2, 0, 1, 0, 0, 0, 1, 'P', 1],
  [1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1],
  [1, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 1],
  [1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1],
  [1, 0, 0, 0, 1, 'P', 1, 0, 1, 'A', 'A', 'A', 1, 0, 1, 'P', 1, 0, 0, 0, 1],
  [1, 1, 1, 0, 1, 0, 1, 0, 1, 'A', 'A', 'A', 1, 0, 1, 0, 1, 0, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1],
  [1, 0, 1, 2, 0, 0, 1, 0, 1, 'P', 0, 0, 1, 0, 1, 0, 0, 2, 1, 0, 1],
  [1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
  [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1],
  [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1],
  [1, 'P', 0, 0, 0, 2, 0, 0, 1, 0, 1, 0, 0, 2, 0, 0, 0, 0, 0, 'P', 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
];

const ZONE_NAMES = {
  fore: 'HET VOORDEK',
  engine: 'DE MACHINEKAMER',
  cargo: 'HET VRACHTRUIM',
  bilge: 'DE BILGE',
  shrine: 'HET RUIM'
};

export class SteamboatMap {
  constructor(scene) {
    this.scene = scene;
    this.cellSize = 4.0;
    this.wallHeight = 3.6;
    this.crateHeight = 1.0;

    this.grid = LAYOUT;
    this.rows = this.grid.length;
    this.cols = this.grid[0].length;

    this.playerStart = { x: 1 * this.cellSize, z: 1 * this.cellSize };
    this.altarLocation = { x: 10 * this.cellSize, z: 11.5 * this.cellSize };
    // The altar's footing. tribute.js draws the shrine to these half-extents
    // and the map collides against them, so the stone the player sees and the
    // stone they bump into cannot drift apart.
    this.altarFootprint = { halfX: 1.9, halfZ: 1.2 };
    // The 'P' cells in the grid above. They are the fallback layout; a run
    // normally overwrites presentSpawns from a seeded plan (see layout.js).
    this.authoredPresentSpawns = [];
    this.presentSpawns = [];
    this.runLayout = null;
    this.walkableTiles = [];
    this.hidingSpots = [];
    this.colliders = [];
    this.disposables = [];

    // Lantern light pool: many fixtures, few actual lights. The nearest ones
    // are lit and the rest are dark props, which keeps the shader cheap.
    this.lanternSpots = [];
    this.lanternPool = [];
    this.lanternRepickTimer = 0;

    this.buildTextures();
    this.parseGrid();
    this.buildWorld();
  }

  // --- Setup -----------------------------------------------------------

  buildTextures() {
    this.deckTexture = TextureFactory.createDeckPlanks();
    this.deckTexture.repeat.set(this.cols * 0.9, this.rows * 0.9);

    this.overheadTexture = TextureFactory.createOverhead();
    this.overheadTexture.repeat.set(this.cols * 0.5, this.rows * 0.5);

    this.burlapTexture = TextureFactory.createBurlapSack();

    this.bulkheadTextures = {};
    this.bulkheadMaterials = {};
    for (const zone of Object.keys(ZONE_NAMES)) {
      const tex = TextureFactory.createBulkhead(zone);
      this.bulkheadTextures[zone] = tex;
      this.bulkheadMaterials[zone] = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.82,
        metalness: 0.28
      });
      this.disposables.push(tex, this.bulkheadMaterials[zone]);
    }
    this.disposables.push(this.deckTexture, this.overheadTexture, this.burlapTexture);
  }

  zoneAtCell(r, c) {
    if (r >= 10 && r <= 13 && c >= 8 && c <= 12) return 'shrine';
    if (r <= 6) return 'fore';
    if (r >= 14) return 'bilge';
    return c >= 12 ? 'cargo' : 'engine';
  }

  zoneAt(x, z) {
    const { r, c } = this.worldToCell(x, z);
    return this.zoneAtCell(r, c);
  }

  zoneName(zone) {
    return ZONE_NAMES[zone] || '';
  }

  worldToCell(x, z) {
    return {
      r: Math.max(0, Math.min(this.rows - 1, Math.round(z / this.cellSize))),
      c: Math.max(0, Math.min(this.cols - 1, Math.round(x / this.cellSize)))
    };
  }

  parseGrid() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const val = this.grid[r][c];
        if (val === 1) continue;

        const x = c * this.cellSize;
        const z = r * this.cellSize;
        const tile = { r, c, x, z };

        if (val === 'S') this.playerStart = { x, z };
        if (val === 'P') this.authoredPresentSpawns.push(tile);
        this.walkableTiles.push(tile);
      }
    }

    this.presentSpawns = [...this.authoredPresentSpawns];

    // Shrine sits between the two altar rows so the player faces it head-on.
    this.altarLocation = { x: 10 * this.cellSize, z: 11.5 * this.cellSize };
  }

  // --- Per-run plan ----------------------------------------------------

  // Swap in a seeded layout: where the pakjes go and which lanterns are dead.
  // Mr. Geil reads his own spawn and circuit straight off the same plan.
  applyRunLayout(layout) {
    if (!layout) return;
    this.runLayout = layout;

    if (layout.presents && layout.presents.length) {
      this.presentSpawns = layout.presents.map(p => ({
        r: p.r, c: p.c,
        x: p.x !== undefined ? p.x : p.c * this.cellSize,
        z: p.z !== undefined ? p.z : p.r * this.cellSize
      }));
    }

    if (layout.lanternsAlive && layout.lanternsAlive.length === this.lanternSpots.length) {
      this.lanternSpots.forEach((spot, i) => {
        spot.alive = layout.lanternsAlive[i];
        spot.bulbMat.color.setHex(spot.alive ? 0xffb268 : 0x241a12);
      });
      // Drop any pooled light bound to a fixture that just died.
      this.lanternRepickTimer = 0;
      for (const light of this.lanternPool) {
        if (light.userData.spot && !light.userData.spot.alive) {
          light.visible = false;
          light.userData.spot = null;
        }
      }
    }
  }

  // --- Geometry --------------------------------------------------------

  buildWorld() {
    const width = this.cols * this.cellSize;
    const depth = this.rows * this.cellSize;
    const cx = width / 2 - this.cellSize / 2;
    const cz = depth / 2 - this.cellSize / 2;

    const floorGeo = new THREE.PlaneGeometry(width, depth);
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.deckTexture,
      roughness: 0.92,
      metalness: 0.04
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.disposables.push(floorGeo, floorMat);

    const ceilGeo = new THREE.PlaneGeometry(width, depth);
    const ceilMat = new THREE.MeshStandardMaterial({
      map: this.overheadTexture,
      roughness: 0.95,
      metalness: 0.3
    });
    const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(cx, this.wallHeight, cz);
    this.scene.add(ceiling);
    this.disposables.push(ceilGeo, ceilMat);

    this.buildWalls();
    this.buildCargoStacks();
    this.buildAltarFooting();
    this.buildPipes();
    this.buildLanterns();
    this.buildLighting();

    // Every collider is in by now, so the crossings can be worked out.
    this.buildEdgeBlocks();
  }

  // The shrine's altar is geometry tribute.js draws, but it is the map that
  // has to stop bodies walking through it.
  buildAltarFooting() {
    const { halfX, halfZ } = this.altarFootprint;
    this.colliders.push({
      minX: this.altarLocation.x - halfX, maxX: this.altarLocation.x + halfX,
      minZ: this.altarLocation.z - halfZ, maxZ: this.altarLocation.z + halfZ
    });
  }

  buildWalls() {
    const wallGeo = new THREE.BoxGeometry(this.cellSize, this.wallHeight, this.cellSize);
    this.disposables.push(wallGeo);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c] !== 1) continue;

        // Skip fully-enclosed blocks: nothing can ever see them.
        if (this.isEnclosed(r, c)) {
          this.pushWallCollider(r, c);
          continue;
        }

        const x = c * this.cellSize;
        const z = r * this.cellSize;
        const wall = new THREE.Mesh(wallGeo, this.bulkheadMaterials[this.zoneAtCell(r, c)]);
        wall.position.set(x, this.wallHeight / 2, z);
        wall.castShadow = true;
        wall.receiveShadow = true;
        this.scene.add(wall);

        this.pushWallCollider(r, c);
      }
    }
  }

  isEnclosed(r, c) {
    const neighbours = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    return neighbours.every(([nr, nc]) => {
      if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) return true;
      return this.grid[nr][nc] === 1;
    });
  }

  pushWallCollider(r, c) {
    const x = c * this.cellSize;
    const z = r * this.cellSize;
    const h = this.cellSize / 2;
    this.colliders.push({ minX: x - h, maxX: x + h, minZ: z - h, maxZ: z + h });
  }

  // Cargo stacks are shoved against a bulkhead rather than parked mid-corridor.
  // The offset and the collider half-extent below must leave every cell centre
  // standable for the widest body in the game (Mr. Geil, radius 0.5), because
  // pathfinding walks cell centre to cell centre — 1.32 - 0.62 = 0.70 m of
  // clearance. Shrink that margin and he wedges himself against the crates.
  buildCargoStacks() {
    const crateGeo = new THREE.BoxGeometry(1.15, 0.9, 1.15);
    const sackGeo = new THREE.BoxGeometry(0.75, 0.55, 0.75);
    const crateMat = new THREE.MeshStandardMaterial({ map: this.burlapTexture, roughness: 0.95 });
    this.disposables.push(crateGeo, sackGeo, crateMat);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c] !== 2) continue;

        const offset = this.offsetTowardWall(r, c, 1.32);
        const x = c * this.cellSize + offset.dx;
        const z = r * this.cellSize + offset.dz;

        const group = new THREE.Group();
        const crate = new THREE.Mesh(crateGeo, crateMat);
        crate.position.y = 0.45;
        crate.rotation.y = rndAngle(0.35);
        crate.castShadow = true;
        crate.receiveShadow = true;
        group.add(crate);

        const sack = new THREE.Mesh(sackGeo, crateMat);
        sack.position.set(0.1, 1.17, -0.08);
        sack.rotation.y = rndAngle(0.7);
        sack.castShadow = true;
        group.add(sack);

        group.position.set(x, 0, z);
        this.scene.add(group);

        const half = 0.62;
        this.colliders.push({ minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half });
        this.hidingSpots.push({ r, c, x, z });
      }
    }
  }

  // Nudge a prop toward whichever neighbouring cell is solid.
  offsetTowardWall(r, c, amount) {
    const candidates = [
      { dr: -1, dc: 0, dx: 0, dz: -amount },
      { dr: 1, dc: 0, dx: 0, dz: amount },
      { dr: 0, dc: -1, dx: -amount, dz: 0 },
      { dr: 0, dc: 1, dx: amount, dz: 0 }
    ];
    for (const cand of candidates) {
      const nr = r + cand.dr;
      const nc = c + cand.dc;
      if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols && this.grid[nr][nc] === 1) {
        return { dx: cand.dx, dz: cand.dz };
      }
    }
    return { dx: amount, dz: 0 };
  }

  buildPipes() {
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 0.7, metalness: 0.75 });
    this.disposables.push(pipeMat);

    // Long runs along the open corridors, just under the overhead.
    const runs = [
      { r: 3, from: 3, to: 11 }, { r: 7, from: 1, to: 5 },
      { r: 9, from: 3, to: 17 }, { r: 13, from: 1, to: 19 },
      { r: 17, from: 5, to: 15 }
    ];

    for (const run of runs) {
      const length = (run.to - run.from) * this.cellSize;
      if (length <= 0) continue;
      const geo = new THREE.CylinderGeometry(0.09, 0.09, length, 8);
      const pipe = new THREE.Mesh(geo, pipeMat);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(
        (run.from + run.to) / 2 * this.cellSize,
        this.wallHeight - 0.32,
        run.r * this.cellSize - 1.1
      );
      this.scene.add(pipe);
      this.disposables.push(geo);
    }
  }

  buildLanterns() {
    const spots = [
      { c: 1, r: 1 }, { c: 5, r: 1 }, { c: 10, r: 1 }, { c: 15, r: 1 }, { c: 19, r: 1 },
      { c: 3, r: 3 }, { c: 9, r: 3 }, { c: 17, r: 3 },
      { c: 1, r: 5 }, { c: 6, r: 5 }, { c: 11, r: 5 }, { c: 16, r: 5 },
      { c: 3, r: 7 }, { c: 9, r: 7 }, { c: 15, r: 7 },
      { c: 4, r: 9 }, { c: 8, r: 9 }, { c: 12, r: 9 }, { c: 16, r: 9 },
      { c: 3, r: 11 }, { c: 17, r: 11 },
      { c: 1, r: 13 }, { c: 5, r: 13 }, { c: 10, r: 13 }, { c: 15, r: 13 }, { c: 19, r: 13 },
      { c: 3, r: 15 }, { c: 11, r: 15 }, { c: 16, r: 15 },
      { c: 2, r: 17 }, { c: 8, r: 17 }, { c: 13, r: 17 },
      { c: 3, r: 19 }, { c: 9, r: 19 }, { c: 16, r: 19 }
    ];

    const cageGeo = new THREE.CylinderGeometry(0.13, 0.17, 0.4, 6, 1, true);
    const cageMat = new THREE.MeshStandardMaterial({
      color: 0x1d160e, metalness: 0.85, roughness: 0.45, side: THREE.DoubleSide
    });
    const bulbGeo = new THREE.SphereGeometry(0.1, 8, 6);
    const chainGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.44, 4);
    this.disposables.push(cageGeo, cageMat, bulbGeo, chainGeo);

    for (const spot of spots) {
      if (this.grid[spot.r] === undefined || this.grid[spot.r][spot.c] === 1) continue;

      const x = spot.c * this.cellSize;
      const z = spot.r * this.cellSize;

      const group = new THREE.Group();

      const chain = new THREE.Mesh(chainGeo, cageMat);
      chain.position.y = 0.42;
      group.add(chain);

      group.add(new THREE.Mesh(cageGeo, cageMat));

      // Unlit material so the filament stays visible in pitch dark.
      const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffb268 });
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      group.add(bulb);
      this.disposables.push(bulbMat);

      group.position.set(x, this.wallHeight - 0.62, z);
      this.scene.add(group);

      this.lanternSpots.push({
        x, z,
        y: this.wallHeight - 0.7,
        bulbMat,
        phase: Math.random() * Math.PI * 2,
        // A handful are dead, so the corridors are unevenly lit.
        alive: Math.random() > 0.22
      });
    }

    for (let i = 0; i < 5; i++) {
      const light = new THREE.PointLight(0xffa855, 0, 14, 2.0);
      light.visible = false;
      this.scene.add(light);
      this.lanternPool.push(light);
    }

    // Dead fixtures get a dim filament so they still read as fixtures.
    for (const spot of this.lanternSpots) {
      if (!spot.alive) spot.bulbMat.color.setHex(0x241a12);
    }
  }

  buildLighting() {
    // Barely-there fill. The flashlight and lanterns do the real work.
    this.ambient = new THREE.AmbientLight(0x0d1218, 0.30);
    this.scene.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(0x1a2430, 0x05070a, 0.22);
    this.scene.add(this.hemi);

    this.scene.fog = new THREE.FogExp2(0x05070a, 0.052);
    this.scene.background = new THREE.Color(0x05070a);
  }

  // --- Per-frame -------------------------------------------------------

  update(delta, time, playerPos) {
    this.lanternRepickTimer -= delta;
    if (this.lanternRepickTimer <= 0) {
      this.lanternRepickTimer = 0.25;
      this.assignLanternLights(playerPos);
    }

    for (const light of this.lanternPool) {
      if (!light.visible || !light.userData.spot) continue;
      const spot = light.userData.spot;
      const flicker = Math.sin(time * 7.3 + spot.phase) * 0.14
        + Math.sin(time * 21.7 + spot.phase * 2.1) * 0.07;
      light.intensity = Math.max(0.25, light.userData.base + flicker);
      spot.bulbMat.color.setRGB(1.0, 0.70 + flicker * 0.1, 0.41 + flicker * 0.08);
    }
  }

  // Bind the pooled lights to the nearest living lanterns.
  assignLanternLights(playerPos) {
    if (!playerPos) return;

    const near = [];
    for (const spot of this.lanternSpots) {
      if (!spot.alive) continue;
      const dx = spot.x - playerPos.x;
      const dz = spot.z - playerPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 900) near.push({ spot, d2 });
    }
    near.sort((a, b) => a.d2 - b.d2);

    for (let i = 0; i < this.lanternPool.length; i++) {
      const light = this.lanternPool[i];
      if (i < near.length) {
        const spot = near[i].spot;
        light.position.set(spot.x, spot.y, spot.z);
        light.userData.spot = spot;
        light.userData.base = 1.9;
        light.intensity = 1.9;
        light.visible = true;
      } else {
        light.visible = false;
        light.userData.spot = null;
      }
    }
  }

  // --- Collision -------------------------------------------------------

  checkCollision(x, z, radius = 0.6) {
    for (let i = 0; i < this.colliders.length; i++) {
      const box = this.colliders[i];
      const closestX = Math.max(box.minX, Math.min(x, box.maxX));
      const closestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
      const dx = x - closestX;
      const dz = z - closestZ;
      if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
  }

  resolveCollision(oldX, oldZ, newX, newZ, radius = 0.6) {
    let finalX = oldX;
    let finalZ = oldZ;

    if (!this.checkCollision(newX, oldZ, radius)) finalX = newX;
    if (!this.checkCollision(finalX, newZ, radius)) finalZ = newZ;

    return { x: finalX, z: finalZ };
  }

  // --- Visibility ------------------------------------------------------

  // Grid traversal (Amanatides & Woo). `blockLow` also counts cargo stacks,
  // which only obstruct a crouching player.
  hasLineOfSight(x0, z0, x1, z1, blockLow = false) {
    const cs = this.cellSize;
    // Continuous grid space where cell c spans [c, c+1).
    let gx = x0 / cs + 0.5;
    let gz = z0 / cs + 0.5;
    const tx = x1 / cs + 0.5;
    const tz = z1 / cs + 0.5;

    let c = Math.floor(gx);
    let r = Math.floor(gz);
    const endC = Math.floor(tx);
    const endR = Math.floor(tz);

    const dx = tx - gx;
    const dz = tz - gz;
    const stepC = dx > 0 ? 1 : -1;
    const stepR = dz > 0 ? 1 : -1;

    const tDeltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
    const tDeltaZ = dz === 0 ? Infinity : Math.abs(1 / dz);

    let tMaxX = dx === 0 ? Infinity
      : ((dx > 0 ? c + 1 - gx : gx - c) * tDeltaX);
    let tMaxZ = dz === 0 ? Infinity
      : ((dz > 0 ? r + 1 - gz : gz - r) * tDeltaZ);

    // Bounded so a degenerate ray can never spin forever.
    const maxSteps = (this.rows + this.cols) * 2;
    for (let i = 0; i < maxSteps; i++) {
      if (c === endC && r === endR) return true;

      if (tMaxX < tMaxZ) {
        tMaxX += tDeltaX;
        c += stepC;
      } else {
        tMaxZ += tDeltaZ;
        r += stepR;
      }

      if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return false;

      const val = this.grid[r][c];
      if (val === 1) return false;
      if (blockLow && val === 2) return false;
      if (tMaxX > 1 && tMaxZ > 1) return true;
    }
    return false;
  }

  // --- Pathfinding -----------------------------------------------------

  isWalkableCell(r, c) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return false;
    return this.grid[r][c] !== 1;
  }

  // Pathfinding hops from one cell centre to the next, so a prop lying across
  // the boundary between two walkable cells blocks a move the grid alone calls
  // legal — and whoever takes that move walks into the furniture and stops.
  // The altar is the one that does it: it straddles the two shrine rows, so
  // the short way in is through the stone and the way round is past it.
  // Worked out once here, then read for free by floodFrom and findPathNextStep.
  buildEdgeBlocks(radius = 0.5) {
    this.blockedEdges = new Uint8Array(this.rows * this.cols);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.isWalkableCell(r, c)) continue;
        for (let d = 0; d < 4; d++) {
          const nr = r + (d === 0 ? -1 : d === 1 ? 1 : 0);
          const nc = c + (d === 2 ? -1 : d === 3 ? 1 : 0);
          if (!this.isWalkableCell(nr, nc)) continue;
          if (this.edgeIsBlocked(r, c, nr, nc, radius)) {
            this.blockedEdges[r * this.cols + c] |= 1 << d;
          }
        }
      }
    }
  }

  // Sampled at the boundary and the quarter points either side of it, which is
  // as fine as it needs to be for a prop wide enough to stop anybody.
  edgeIsBlocked(r, c, nr, nc, radius) {
    for (const t of [0.25, 0.5, 0.75]) {
      const x = (c + (nc - c) * t) * this.cellSize;
      const z = (r + (nr - r) * t) * this.cellSize;
      if (this.checkCollision(x, z, radius)) return true;
    }
    return false;
  }

  // Can a body cross from this cell into its neighbour in direction `d`?
  canStep(r, c, d) {
    if (!this.blockedEdges) return true;
    return (this.blockedEdges[r * this.cols + c] & (1 << d)) === 0;
  }

  getRandomWalkableTile() {
    return this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)];
  }

  // Pick a walkable tile at least `minDist` away from a point. An optional
  // filter narrows the pool; if nothing passes both, the distance goes first
  // and the filter second, so a caller always gets a tile back.
  getRandomTileFrom(x, z, minDist, filter = null) {
    const matching = filter ? this.walkableTiles.filter(filter) : this.walkableTiles;
    const candidates = matching.filter(t => {
      const dx = t.x - x;
      const dz = t.z - z;
      return dx * dx + dz * dz > minDist * minDist;
    });
    const pool = candidates.length ? candidates
      : (matching.length ? matching : this.walkableTiles);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Every cell reachable on foot from a point, as `r * cols + c` indices.
  // Used to prove a generated layout is not stranding anything behind a wall.
  floodFrom(x, z) {
    const start = this.worldToCell(x, z);
    const seen = new Set();
    if (!this.isWalkableCell(start.r, start.c)) return seen;

    const stack = [start.r * this.cols + start.c];
    seen.add(stack[0]);

    while (stack.length) {
      const idx = stack.pop();
      const r = (idx / this.cols) | 0;
      const c = idx - r * this.cols;

      for (let d = 0; d < 4; d++) {
        const nr = r + (d === 0 ? -1 : d === 1 ? 1 : 0);
        const nc = c + (d === 2 ? -1 : d === 3 ? 1 : 0);
        if (!this.isWalkableCell(nr, nc) || !this.canStep(r, c, d)) continue;
        const nIdx = nr * this.cols + nc;
        if (seen.has(nIdx)) continue;
        seen.add(nIdx);
        stack.push(nIdx);
      }
    }
    return seen;
  }

  // BFS to the target, returning the world position of the next cell to walk
  // toward. Returns null when the target is unreachable.
  findPathNextStep(startX, startZ, targetX, targetZ) {
    const start = this.worldToCell(startX, startZ);
    const goal = this.worldToCell(targetX, targetZ);

    if (start.r === goal.r && start.c === goal.c) {
      return { x: targetX, z: targetZ };
    }
    if (!this.isWalkableCell(goal.r, goal.c)) return null;

    const cameFrom = new Int32Array(this.rows * this.cols).fill(-1);
    const startIdx = start.r * this.cols + start.c;
    const goalIdx = goal.r * this.cols + goal.c;
    cameFrom[startIdx] = startIdx;

    // Ring buffer avoids Array.shift()'s O(n) cost on every pop.
    const queue = new Int32Array(this.rows * this.cols);
    let head = 0;
    let tail = 0;
    queue[tail++] = startIdx;

    let found = false;
    while (head < tail) {
      const idx = queue[head++];
      if (idx === goalIdx) { found = true; break; }

      const r = (idx / this.cols) | 0;
      const c = idx - r * this.cols;

      for (let d = 0; d < 4; d++) {
        const nr = r + (d === 0 ? -1 : d === 1 ? 1 : 0);
        const nc = c + (d === 2 ? -1 : d === 3 ? 1 : 0);
        if (!this.isWalkableCell(nr, nc) || !this.canStep(r, c, d)) continue;
        const nIdx = nr * this.cols + nc;
        if (cameFrom[nIdx] !== -1) continue;
        cameFrom[nIdx] = idx;
        queue[tail++] = nIdx;
      }
    }

    if (!found) return null;

    // Walk back from the goal until the cell whose parent is the start.
    let idx = goalIdx;
    let guard = this.rows * this.cols;
    while (guard-- > 0) {
      const parent = cameFrom[idx];
      if (parent === idx) break;
      if (parent === startIdx) {
        const r = (idx / this.cols) | 0;
        const c = idx - r * this.cols;
        return { x: c * this.cellSize, z: r * this.cellSize };
      }
      idx = parent;
    }
    return { x: targetX, z: targetZ };
  }

  dispose() {
    for (const item of this.disposables) {
      if (item && typeof item.dispose === 'function') item.dispose();
    }
    this.disposables.length = 0;
  }
}

function rndAngle(spread) {
  return (Math.random() - 0.5) * spread;
}
