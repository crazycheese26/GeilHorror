// The tribute altar in the hold. Five anime body pillows, laid out one by one while
// you stand still and exposed, and Mr. Geil lets you off the boat.

import { TextureFactory } from './textures.js';
import { horrorAudio } from './audio.js';

const REACH = 3.6;
const OFFER_SECONDS = 2.6;

export class TributeAltar {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.pos = map.altarLocation;

    this.group = new THREE.Group();
    this.candles = [];
    this.placed = [];
    this.disposables = [];

    this.isOffered = false;
    this.progress = 0;

    this.build();
  }

  build() {
    this.group.position.set(this.pos.x, 0, this.pos.z);

    // Sized off the map's footing so the stone drawn here is the stone bodies
    // collide with.
    const foot = this.map.altarFootprint;
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 0.94, metalness: 0.1 });
    const baseGeo = new THREE.BoxGeometry(foot.halfX * 2, 0.42, foot.halfZ * 2);
    const base = new THREE.Mesh(baseGeo, stoneMat);
    base.position.y = 0.21;
    base.receiveShadow = true;
    base.castShadow = true;
    this.group.add(base);

    const clothTex = TextureFactory.createAltarCloth();
    const clothMat = new THREE.MeshStandardMaterial({ map: clothTex, roughness: 0.85, metalness: 0.05 });
    const tableGeo = new THREE.BoxGeometry(foot.halfX * 2 - 0.5, 0.62, foot.halfZ * 2 - 0.4);
    this.table = new THREE.Mesh(tableGeo, clothMat);
    this.table.position.y = 0.73;
    this.table.castShadow = true;
    this.table.receiveShadow = true;
    this.group.add(this.table);

    // Sinterklaas' staf, leant against the altar.
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xb08b31, metalness: 0.92, roughness: 0.28 });
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.6, 10);
    const staff = new THREE.Group();
    staff.add(new THREE.Mesh(poleGeo, goldMat));
    const curlGeo = new THREE.TorusGeometry(0.22, 0.038, 8, 20, Math.PI * 1.5);
    const curl = new THREE.Mesh(curlGeo, goldMat);
    curl.position.set(0.16, 1.32, 0);
    staff.add(curl);
    staff.position.set(-1.92, 1.3, -0.7);
    staff.rotation.z = -0.16;
    this.group.add(staff);

    this.createCandle(-1.34, 1.06, 0.66);
    this.createCandle(-1.34, 1.06, -0.66);
    this.createCandle(1.34, 1.06, 0.66);
    this.createCandle(1.34, 1.06, -0.66);

    this.light = new THREE.PointLight(0xffa03c, 1.6, 12, 2.0);
    this.light.position.set(0, 1.9, 0);
    this.group.add(this.light);

    // Visible from down the corridor, so the hold is findable.
    const haloTex = TextureFactory.createBlobShadow();
    const haloMat = new THREE.SpriteMaterial({
      map: haloTex, color: 0xffa64d, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true
    });
    this.halo = new THREE.Sprite(haloMat);
    this.halo.scale.set(6, 6, 1);
    this.halo.position.y = 1.5;
    this.group.add(this.halo);

    this.scene.add(this.group);
    this.disposables.push(
      stoneMat, baseGeo, clothTex, clothMat, tableGeo,
      goldMat, poleGeo, curlGeo, haloTex, haloMat
    );
  }

  createCandle(x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const waxGeo = new THREE.CylinderGeometry(0.038, 0.045, 0.34, 8);
    const waxMat = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.95 });
    group.add(new THREE.Mesh(waxGeo, waxMat));

    const flameGeo = new THREE.SphereGeometry(0.032, 6, 5);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa93c });
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.y = 0.2;
    flame.scale.set(1, 1.7, 1);
    group.add(flame);

    this.group.add(group);
    this.disposables.push(waxGeo, waxMat, flameGeo, flameMat);
    this.candles.push({ flame, flameMat, phase: Math.random() * Math.PI * 2 });
  }

  // --- Per-frame -------------------------------------------------------

  isInRange(playerPos) {
    return Math.hypot(playerPos.x - this.pos.x, playerPos.z - this.pos.z) < REACH;
  }

  // `crew` carries what a run with other people in it needs:
  //   remoteOffering  somebody else is holding it down, wherever they are
  //   driven          this browser does not rule on the offering, so the
  //                   progress bar is set from outside (see syncProgress) and
  //                   nothing here may touch it
  // Left out, this is the game played alone and behaves exactly as it did.
  update(delta, playerPos, interactHeld, itemManager, crew = {}) {
    const time = performance.now() / 1000;
    for (const c of this.candles) {
      const flick = 0.8 + Math.sin(time * 11 + c.phase) * 0.2;
      c.flame.scale.set(flick, 1.7 * flick, flick);
      c.flameMat.color.setRGB(1, 0.62 * flick, 0.22 * flick);
    }
    this.light.intensity = 1.5 + Math.sin(time * 6.5) * 0.18;

    const inRange = this.isInRange(playerPos);
    const ready = itemManager.isReadyForTribute();
    const canOffer = inRange && !this.isOffered && ready;

    if (crew.driven) return { inRange, progress: this.progress, canOffer };

    const laying = (canOffer && interactHeld) ||
      (crew.remoteOffering && ready && !this.isOffered);

    if (laying) {
      const before = this.progress;
      this.progress = Math.min(1, this.progress + delta / OFFER_SECONDS);
      this.placePillowsUpTo(this.progress, itemManager);
      // One chime per pillow laid down.
      const step = 1 / itemManager.inventory.length;
      if (Math.floor(before / step) !== Math.floor(this.progress / step)) {
        horrorAudio.playPillowChime();
      }
    } else if (!this.isOffered) {
      this.progress = Math.max(0, this.progress - delta * 1.2);
      this.placePillowsUpTo(this.progress, itemManager);
    }

    return { inRange, progress: this.progress, canOffer };
  }

  // The host is the only one that gets to advance the offering, so everybody
  // else is told where it is up to and lays the pillows out to match. Nothing
  // else about the shrine — the candles, the light — needs saying: it is the
  // same altar on every browser.
  syncProgress(progress, itemManager) {
    if (this.isOffered || !Number.isFinite(progress)) return;
    const before = this.progress;
    this.progress = Math.max(0, Math.min(1, progress));
    this.placePillowsUpTo(this.progress, itemManager);
    const total = itemManager.inventory.length;
    if (total > 0) {
      const step = 1 / total;
      if (Math.floor(before / step) < Math.floor(this.progress / step)) {
        horrorAudio.playPillowChime();
      }
    }
  }

  // Lay out however many pillows the hold has earned so far.
  placePillowsUpTo(progress, itemManager) {
    const total = itemManager.inventory.length;
    if (total === 0) return;
    const wanted = Math.min(total, Math.floor(progress * total + 0.0001));

    while (this.placed.length < wanted) {
      const idx = this.placed.length;
      const data = itemManager.inventory[idx];
      const geo = new THREE.BoxGeometry(0.5, 1.0, 0.14);
      const sideMat = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.9 });
      const faceMat = new THREE.MeshStandardMaterial({
        map: data.texture, roughness: 0.6,
        emissive: 0x1a1414, emissiveMap: data.texture, emissiveIntensity: 0.4
      });
      const mesh = new THREE.Mesh(geo, [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat]);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = (idx - (total - 1) / 2) * 0.22;
      mesh.position.set((idx - (total - 1) / 2) * 0.62, 1.09, 0);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.placed.push(mesh);
      this.disposables.push(geo, sideMat, faceMat);
    }

    while (this.placed.length > wanted) {
      const mesh = this.placed.pop();
      this.group.remove(mesh);
      this.releaseMesh(mesh);
    }
  }

  // Drop a pillow mesh's own geometry and materials, and stop tracking them.
  releaseMesh(mesh) {
    const owned = [mesh.geometry, ...(Array.isArray(mesh.material) ? mesh.material : [mesh.material])];
    for (const item of new Set(owned)) {
      const i = this.disposables.indexOf(item);
      if (i >= 0) this.disposables.splice(i, 1);
      if (item && typeof item.dispose === 'function') item.dispose();
    }
  }

  // --- Completion ------------------------------------------------------

  complete(enemy) {
    if (this.isOffered) return;
    this.isOffered = true;
    this.progress = 1;

    this.light.color.setHex(0xffd066);
    this.light.intensity = 7.0;
    this.light.distance = 26;
    this.halo.material.color.setHex(0xffd98a);
    this.halo.material.opacity = 0.85;
    this.halo.scale.set(11, 11, 1);

    enemy.pacify();
    // He comes to collect, and is delighted. The altar straddles the boundary
    // between the two shrine rows, so half a cell back is the middle of the row
    // behind it — a standable cell. Any further and he is inside the bulkhead
    // that closes het ruim off, which is where he used to end up.
    enemy.x = this.pos.x;
    enemy.z = this.pos.z - this.map.cellSize / 2;

    horrorAudio.playTributeSuccess();
  }

  reset() {
    this.isOffered = false;
    this.progress = 0;
    // Laid-out pillows are rebuilt from scratch next run, so free them here
    // rather than letting a set accumulate on every retry.
    for (const mesh of this.placed) {
      this.group.remove(mesh);
      this.releaseMesh(mesh);
    }
    this.placed.length = 0;
    this.light.color.setHex(0xffa03c);
    this.light.intensity = 1.6;
    this.light.distance = 12;
    this.halo.material.color.setHex(0xffa64d);
    this.halo.material.opacity = 0.42;
    this.halo.scale.set(6, 6, 1);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const item of this.disposables) {
      if (item && typeof item.dispose === 'function') item.dispose();
    }
    this.disposables.length = 0;
  }
}
