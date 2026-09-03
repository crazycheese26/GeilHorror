// Steamboat Corridor Maze & 3D Environment Builder
// "De donkere gangen van de stoomboot van Sinterklaas"

import { TextureFactory } from './textures.js';

export class SteamboatMap {
  constructor(scene) {
    this.scene = scene;
    this.cellSize = 4.0; // 4 meters per grid cell
    this.wallHeight = 3.6;

    // Grid layout:
    // 1 = Wall, 0 = Corridor, 2 = Crate/Obstacle
    // 'S' = Player Start (1, 1)
    // 'A' = Tribute Altar Chamber
    // 'P' = Sint Gift Present spawn spots
    this.grid = [
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 'S', 0, 0, 1, 'P', 0, 0, 0, 1, 0, 0, 0, 'P', 1, 0, 0, 0, 0, 'P', 1],
      [1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1],
      [1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      [1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1],
      [1, 0, 0, 0, 1, 0, 0, 0, 1, 'P', 1, 0, 0, 0, 1, 0, 0, 0, 1, 'P', 1],
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
      [1, 'P', 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 'P', 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    ];

    this.rows = this.grid.length;
    this.cols = this.grid[0].length;

    this.playerStart = { x: 1 * this.cellSize, z: 1 * this.cellSize };
    this.altarLocation = { x: 10 * this.cellSize, z: 12 * this.cellSize };
    this.presentSpawns = [];
    this.walkableTiles = [];
    this.lanterns = [];
    this.colliders = []; // Bounding boxes for collision

    this.loadTextures();
    this.parseGrid();
    this.build3DWorld();
  }

  loadTextures() {
    this.woodTexture = TextureFactory.createWoodDeck();
    this.woodTexture.repeat.set(this.cols * 0.75, this.rows * 0.75);

    this.wallTexture = TextureFactory.createSteelWall();
    this.wallTexture.repeat.set(1, 1);

    this.ceilingTexture = TextureFactory.createCeiling();
    this.ceilingTexture.repeat.set(this.cols * 0.5, this.rows * 0.5);

    this.burlapTexture = TextureFactory.createBurlapSack();
  }

  parseGrid() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const val = this.grid[r][c];
        const worldX = c * this.cellSize;
        const worldZ = r * this.cellSize;

        if (val === 'S') {
          this.playerStart = { x: worldX, z: worldZ };
          this.walkableTiles.push({ r, c, x: worldX, z: worldZ });
        } else if (val === 'P') {
          this.presentSpawns.push({ r, c, x: worldX, z: worldZ });
          this.walkableTiles.push({ r, c, x: worldX, z: worldZ });
        } else if (val === 'A') {
          // Tribute chamber
          if (r === 12 && c === 10) {
            this.altarLocation = { x: worldX, z: worldZ };
          }
          this.walkableTiles.push({ r, c, x: worldX, z: worldZ });
        } else if (val === 0) {
          this.walkableTiles.push({ r, c, x: worldX, z: worldZ });
        }
      }
    }
  }

  build3DWorld() {
    const totalWidth = this.cols * this.cellSize;
    const totalDepth = this.rows * this.cellSize;

    // 1. Floor (Ship deck wood)
    const floorGeo = new THREE.PlaneGeometry(totalWidth, totalDepth);
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.woodTexture,
      roughness: 0.8,
      metalness: 0.1
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(totalWidth / 2 - this.cellSize / 2, 0, totalDepth / 2 - this.cellSize / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 2. Ceiling (Industrial plates)
    const ceilingGeo = new THREE.PlaneGeometry(totalWidth, totalDepth);
    const ceilingMat = new THREE.MeshStandardMaterial({
      map: this.ceilingTexture,
      roughness: 0.9,
      metalness: 0.4
    });
    const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(totalWidth / 2 - this.cellSize / 2, this.wallHeight, totalDepth / 2 - this.cellSize / 2);
    this.scene.add(ceiling);

    // 3. Walls and Obstacles
    const wallGeo = new THREE.BoxGeometry(this.cellSize, this.wallHeight, this.cellSize);
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.wallTexture,
      roughness: 0.6,
      metalness: 0.5
    });

    const crateGeo = new THREE.BoxGeometry(this.cellSize * 0.7, 1.8, this.cellSize * 0.7);
    const crateMat = new THREE.MeshStandardMaterial({
      map: this.burlapTexture,
      roughness: 0.9
    });

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const val = this.grid[r][c];
        const worldX = c * this.cellSize;
        const worldZ = r * this.cellSize;

        if (val === 1) {
          // Steel bulkhead wall block
          const wall = new THREE.Mesh(wallGeo, wallMat);
          wall.position.set(worldX, this.wallHeight / 2, worldZ);
          wall.castShadow = true;
          wall.receiveShadow = true;
          this.scene.add(wall);

          this.colliders.push({
            minX: worldX - this.cellSize / 2,
            maxX: worldX + this.cellSize / 2,
            minZ: worldZ - this.cellSize / 2,
            maxZ: worldZ + this.cellSize / 2
          });
        } else if (val === 2) {
          // Cargo Pepernoten crate / stack
          const crate = new THREE.Mesh(crateGeo, crateMat);
          crate.position.set(worldX, 0.9, worldZ);
          crate.rotation.y = Math.random() * 0.4;
          crate.castShadow = true;
          this.scene.add(crate);

          this.colliders.push({
            minX: worldX - (this.cellSize * 0.35),
            maxX: worldX + (this.cellSize * 0.35),
            minZ: worldZ - (this.cellSize * 0.35),
            maxZ: worldZ + (this.cellSize * 0.35)
          });
        }
      }
    }

    // 4. Atmospheric Lanterns in corridors
    this.addNauticalLanterns();

    // 5. Global Illumination (HemisphereLight + AmbientLight ensures crystal-clear visibility on dark screens)
    const hemiLight = new THREE.HemisphereLight(0xffeedd, 0x445566, 1.4);
    this.scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0x778899, 1.0);
    this.scene.add(ambientLight);

    // Light atmospheric fog starting far away (24m - 60m)
    this.scene.fog = new THREE.Fog(0x181e28, 24, 60);
  }

  addNauticalLanterns() {
    // Strategic positions along all corridors
    const lanternSpots = [
      { c: 1, r: 1, hasLight: true }, // Player start cabin
      { c: 4, r: 1, hasLight: false }, { c: 9, r: 1, hasLight: false }, { c: 14, r: 1, hasLight: false }, { c: 18, r: 1, hasLight: false },
      { c: 1, r: 5, hasLight: false }, { c: 6, r: 5, hasLight: false }, { c: 11, r: 5, hasLight: false }, { c: 16, r: 5, hasLight: false },
      { c: 3, r: 9, hasLight: false }, { c: 7, r: 9, hasLight: false }, { c: 13, r: 9, hasLight: false }, { c: 17, r: 9, hasLight: false },
      { c: 1, r: 13, hasLight: false }, { c: 5, r: 13, hasLight: false }, { c: 10, r: 13, hasLight: true }, { c: 15, r: 13, hasLight: false }, { c: 19, r: 13, hasLight: false },
      { c: 2, r: 17, hasLight: false }, { c: 7, r: 17, hasLight: false }, { c: 12, r: 17, hasLight: false }, { c: 17, r: 17, hasLight: false },
      { c: 10, r: 11, hasLight: true } // Shrine entry
    ];

    lanternSpots.forEach(spot => {
      const x = spot.c * this.cellSize;
      const z = spot.r * this.cellSize;

      // Lantern cage model
      const lanternGroup = new THREE.Group();

      const cageGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.45, 6);
      const cageMat = new THREE.MeshStandardMaterial({
        color: 0x332210,
        metalness: 0.8,
        roughness: 0.3
      });
      const cage = new THREE.Mesh(cageGeo, cageMat);
      lanternGroup.add(cage);

      // Glowing glass bulb
      const bulbGeo = new THREE.SphereGeometry(0.14, 8, 8);
      const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffcc66 });
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      lanternGroup.add(bulb);

      lanternGroup.position.set(x, this.wallHeight - 0.5, z);
      this.scene.add(lanternGroup);

      if (spot.hasLight) {
        const light = new THREE.PointLight(0xffaa33, 2.5, 20);
        light.position.set(x, this.wallHeight - 0.6, z);
        light.castShadow = false;
        this.scene.add(light);

        this.lanterns.push({
          light,
          baseIntensity: 2.5,
          phase: Math.random() * Math.PI * 2
        });
      }
    });
  }

  // Update flickering lanterns
  update(time) {
    this.lanterns.forEach(l => {
      // Subtle organic flicker
      const flicker = Math.sin(time * 8 + l.phase) * 0.15 + (Math.random() - 0.5) * 0.08;
      l.light.intensity = Math.max(0.2, l.baseIntensity + flicker);
    });
  }

  // Spatial Collision check for player & enemy
  checkCollision(x, z, radius = 0.6) {
    for (let i = 0; i < this.colliders.length; i++) {
      const box = this.colliders[i];
      // Circle vs AABB
      const closestX = Math.max(box.minX, Math.min(x, box.maxX));
      const closestZ = Math.max(box.minZ, Math.min(z, box.maxZ));

      const distX = x - closestX;
      const distZ = z - closestZ;
      const distSq = distX * distX + distZ * distZ;

      if (distSq < radius * radius) {
        return true;
      }
    }
    return false;
  }

  // Slide collision resolution
  resolveCollision(oldX, oldZ, newX, newZ, radius = 0.6) {
    let finalX = oldX;
    let finalZ = oldZ;

    // Try moving X only
    if (!this.checkCollision(newX, oldZ, radius)) {
      finalX = newX;
    }
    // Try moving Z only
    if (!this.checkCollision(finalX, newZ, radius)) {
      finalZ = newZ;
    }

    return { x: finalX, z: finalZ };
  }

  getRandomWalkableTile() {
    const idx = Math.floor(Math.random() * this.walkableTiles.length);
    return this.walkableTiles[idx];
  }
}
