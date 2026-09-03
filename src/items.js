// Sint presents and the anime body pillows inside them.
//
// Opening one is the game's deliberate risk: it pins you in place for nearly
// two seconds and tearing the paper is the loudest thing you can do.

import { TextureFactory } from './textures.js';
import { horrorAudio } from './audio.js';

const REACH = 2.4;
const UNWRAP_SECONDS = 1.7;
const UNWRAP_NOISE_RADIUS = 30;

export class ItemManager {
  // `rng` is the run's seeded generator, so the same seed puts the same pillow
  // in the same pakje. Left out, presents fall back to Math.random.
  constructor(scene, map, rng = null) {
    this.scene = scene;
    this.map = map;
    this.rand = rng ? () => rng.next() : Math.random;

    this.pillows = TextureFactory.createAnimePillows();
    this.presents = [];
    this.inventory = [];
    this.collectedCount = 0;
    this.requiredCount = 5;

    this.progress = 0;
    this.activeTarget = null;

    // Fired by the game loop: (pillowData, worldX, worldZ).
    this.onUnwrapped = null;

    this.wrapTexture = TextureFactory.createPresentWrap();
    this.haloTexture = TextureFactory.createBlobShadow();
    this.disposables = [this.wrapTexture, this.haloTexture];
    for (const p of this.pillows) this.disposables.push(p.texture);

    this.buildPresents();
  }

  buildPresents() {
    const shuffled = [...this.pillows];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }

    this.map.presentSpawns.forEach((spawn, idx) => {
      const offset = this.map.offsetTowardWall(spawn.r, spawn.c, 0.95);
      const x = spawn.x + offset.dx;
      const z = spawn.z + offset.dz;
      const present = this.createPresent(x, z, shuffled[idx % shuffled.length], idx);
      this.scene.add(present.group);
      this.presents.push(present);
    });
  }

  createPresent(x, z, pillowData, id) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = this.rand() * Math.PI * 2;

    const boxGeo = new THREE.BoxGeometry(0.78, 0.6, 0.78);
    const boxMat = new THREE.MeshStandardMaterial({
      map: this.wrapTexture, roughness: 0.62, metalness: 0.05
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.y = 0.3;
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);

    const ribbonMat = new THREE.MeshStandardMaterial({
      color: 0xb8912f, roughness: 0.45, metalness: 0.55
    });
    const lidGeo = new THREE.BoxGeometry(0.85, 0.13, 0.85);
    const lid = new THREE.Mesh(lidGeo, ribbonMat);
    lid.position.y = 0.64;
    lid.castShadow = true;
    group.add(lid);

    const bowGeo = new THREE.TorusGeometry(0.15, 0.035, 6, 14);
    const bow = new THREE.Mesh(bowGeo, ribbonMat);
    bow.rotation.x = Math.PI / 2;
    bow.position.y = 0.73;
    group.add(bow);

    // Additive halo so a present is a visible smudge of warmth down a
    // corridor. Cheaper than giving every present a real light.
    const haloMat = new THREE.SpriteMaterial({
      map: this.haloTexture,
      color: 0xffb060,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(2.6, 2.6, 1);
    halo.position.y = 0.5;
    group.add(halo);

    const pillowGeo = new THREE.BoxGeometry(0.62, 1.3, 0.18);
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.9 });
    const faceMat = new THREE.MeshStandardMaterial({
      map: pillowData.texture, roughness: 0.62, metalness: 0.0,
      emissive: 0x221a1a, emissiveMap: pillowData.texture, emissiveIntensity: 0.35
    });
    const pillow = new THREE.Mesh(pillowGeo, [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat]);
    pillow.position.y = 0.4;
    pillow.visible = false;
    group.add(pillow);

    this.disposables.push(boxGeo, boxMat, lidGeo, ribbonMat, bowGeo, haloMat, pillowGeo, sideMat, faceMat);

    return {
      id, group, box, lid, bow, halo, haloMat, pillow, pillowData,
      isUnwrapped: false,
      revealTimer: 0,
      worldPos: { x, z }
    };
  }

  // --- Queries (no side effects) ---------------------------------------

  getNearest(playerPos) {
    let best = null;
    let bestDist = REACH;

    for (const p of this.presents) {
      if (p.isUnwrapped) continue;
      const d = Math.hypot(playerPos.x - p.worldPos.x, playerPos.z - p.worldPos.z);
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  isReadyForTribute() {
    return this.collectedCount >= this.requiredCount;
  }

  remaining() {
    return Math.max(0, this.requiredCount - this.collectedCount);
  }

  // --- Per-frame --------------------------------------------------------

  update(delta, playerPos, interactHeld, canInteract) {
    const target = canInteract ? this.getNearest(playerPos) : null;

    if (target && target === this.activeTarget && interactHeld) {
      this.progress += delta / UNWRAP_SECONDS;
      if (this.progress >= 1) {
        this.unwrap(target);
        this.progress = 0;
        this.activeTarget = null;
      } else {
        horrorAudio.playTear(this.progress);
      }
    } else {
      this.activeTarget = target;
      // Bleed progress away rather than dropping it, so a stutter is forgiving.
      this.progress = Math.max(0, this.progress - delta * 1.6);
    }

    for (const p of this.presents) {
      if (p.revealTimer > 0) {
        p.revealTimer -= delta;
        const t = 1 - Math.max(0, p.revealTimer) / 1.2;
        p.pillow.position.y = 0.4 + t * 0.9;
        p.pillow.rotation.y += delta * 3.0;
        p.pillow.scale.setScalar(Math.max(0.001, 1 - t * 0.65));
        if (p.revealTimer <= 0) p.pillow.visible = false;
      }
      // Halo breathes, and dies once the present is spent.
      if (!p.isUnwrapped) {
        p.haloMat.opacity = 0.38 + Math.sin(performance.now() / 700 + p.id) * 0.1;
      }
    }

    return { target: this.activeTarget, progress: this.progress };
  }

  unwrap(present) {
    if (present.isUnwrapped) return;
    present.isUnwrapped = true;

    present.lid.position.set(0.42, 0.22, 0.18);
    present.lid.rotation.set(0.5, 0.3, 0.8);
    present.bow.visible = false;
    present.pillow.visible = true;
    present.revealTimer = 1.2;
    present.haloMat.opacity = 0.0;

    this.collectedCount++;
    this.inventory.push(present.pillowData);

    horrorAudio.playUnwrap();

    if (this.onUnwrapped) {
      this.onUnwrapped(present.pillowData, present.worldPos.x, present.worldPos.z, UNWRAP_NOISE_RADIUS);
    }
  }

  dispose() {
    for (const p of this.presents) this.scene.remove(p.group);
    for (const item of this.disposables) {
      if (item && typeof item.dispose === 'function') item.dispose();
    }
    this.presents.length = 0;
    this.disposables.length = 0;
  }
}
