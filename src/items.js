// Sint Presents & Anime Body Pillows (Dakimakura) System
// Unwrap gifts left by Sinterklaas to find waifu body pillows to appease Mr. Geil!

import { TextureFactory } from './textures.js';
import { horrorAudio } from './audio.js';

export class ItemManager {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;

    this.presents = [];
    this.pillows = TextureFactory.createAnimePillows();
    this.collectedCount = 0;
    this.requiredCount = 5;
    this.inventory = [];

    this.presentWrapTexture = TextureFactory.createPresentWrap();
    this.setupPresents();
  }

  setupPresents() {
    const spawns = this.map.presentSpawns;
    // Shuffle waifu pillows to assign uniquely
    const shuffledPillows = [...this.pillows].sort(() => Math.random() - 0.5);

    spawns.forEach((spawn, idx) => {
      const pillowData = shuffledPillows[idx % shuffledPillows.length];
      const presentObj = this.createPresentMesh(spawn.x, spawn.z, pillowData, idx);
      this.scene.add(presentObj.group);
      this.presents.push(presentObj);
    });
  }

  createPresentMesh(x, z, pillowData, id) {
    const group = new THREE.Group();
    group.position.set(x, 0.45, z);

    // 1. Gift Box Base
    const boxGeo = new THREE.BoxGeometry(0.9, 0.7, 0.9);
    const boxMat = new THREE.MeshStandardMaterial({
      map: this.presentWrapTexture,
      roughness: 0.4,
      metalness: 0.1
    });
    const boxMesh = new THREE.Mesh(boxGeo, boxMat);
    boxMesh.castShadow = true;
    group.add(boxMesh);

    // 2. Gift Lid
    const lidGeo = new THREE.BoxGeometry(0.96, 0.15, 0.96);
    const lidMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37, // Gold ribbon top
      roughness: 0.3,
      metalness: 0.6
    });
    const lidMesh = new THREE.Mesh(lidGeo, lidMat);
    lidMesh.position.y = 0.38;
    group.add(lidMesh);

    // 3. Ribbon Bow on top
    const bowGeo = new THREE.TorusGeometry(0.18, 0.04, 8, 16);
    const bowMesh = new THREE.Mesh(bowGeo, lidMat);
    bowMesh.rotation.x = Math.PI / 2;
    bowMesh.position.y = 0.48;
    group.add(bowMesh);

    // 4. Subtle Warm Glow
    const light = new THREE.PointLight(0xffdd66, 0.8, 4);
    light.position.y = 0.6;
    group.add(light);

    // 5. 3D Anime Body Pillow (Hidden inside until unwrapped)
    const pillowGeo = new THREE.BoxGeometry(0.75, 1.5, 0.22);
    // Texture on front and back
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    const faceMat = new THREE.MeshStandardMaterial({
      map: pillowData.texture,
      roughness: 0.5,
      metalness: 0.05
    });
    const pillowMaterials = [
      sideMat, sideMat, sideMat, sideMat, faceMat, faceMat
    ];
    const pillowMesh = new THREE.Mesh(pillowGeo, pillowMaterials);
    pillowMesh.position.set(0, 0, 0);
    pillowMesh.visible = false;
    group.add(pillowMesh);

    return {
      id,
      group,
      boxMesh,
      lidMesh,
      pillowMesh,
      light,
      pillowData,
      isUnwrapped: false,
      isCollected: false,
      animatingPillow: false,
      animProgress: 0,
      worldPos: { x, z }
    };
  }

  update(delta, playerPos) {
    let nearestPresent = null;
    let minDist = 2.6;

    this.presents.forEach(p => {
      const dx = playerPos.x - p.worldPos.x;
      const dz = playerPos.z - p.worldPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Check proximity for interaction
      if (!p.isUnwrapped && dist < minDist) {
        nearestPresent = p;
        minDist = dist;
      }

      // Pillow floating animation when unwrapped
      if (p.animatingPillow && !p.isCollected) {
        p.animProgress += delta * 1.8;
        p.pillowMesh.position.y = 0.5 + Math.sin(p.animProgress * 3) * 0.15;
        p.pillowMesh.rotation.y += delta * 2.2;

        // Auto collect after floating for a brief moment
        if (p.animProgress > 2.0) {
          this.collectPillow(p);
        }
      }
    });

    return nearestPresent;
  }

  unwrapPresent(present) {
    if (present.isUnwrapped) return;
    present.isUnwrapped = true;
    present.animatingPillow = true;

    // Pop lid off with dramatic tilt
    present.lidMesh.position.y += 0.4;
    present.lidMesh.position.x += 0.35;
    present.lidMesh.rotation.z = 0.6;

    // Reveal 3D Body Pillow
    present.pillowMesh.visible = true;
    present.pillowMesh.position.y = 0.2;

    // Sound effect: Paper ripping + joyful anime chime
    horrorAudio.playUnwrap();

    // Show on-screen discovery card
    this.showPillowDiscoveryModal(present.pillowData);
  }

  collectPillow(present) {
    if (present.isCollected) return;
    present.isCollected = true;
    present.animatingPillow = false;
    present.pillowMesh.visible = false;
    present.light.intensity = 0.1;

    this.collectedCount++;
    this.inventory.push(present.pillowData);

    // Update HUD Pillows badge
    this.updateHUD();

    // Notify player if quota reached
    if (this.collectedCount >= this.requiredCount) {
      const banner = document.getElementById('objective-banner');
      if (banner) {
        banner.innerHTML = "✨ YOU HAVE COLLECTED 5 ANIME BODY PILLOWS!<br>Hurry to the <b>TRIBUTE ALTAR</b> in the central hold to appease Mr. Geil!";
        banner.classList.add('pulse-gold');
      }
    }
  }

  showPillowDiscoveryModal(pillowData) {
    const modal = document.getElementById('pillow-discovery');
    if (!modal) return;

    modal.innerHTML = `
      <div class="pillow-card">
        <div class="pillow-badge">✨ SINT GIFT UNWRAPPED! ✨</div>
        <h2 class="pillow-title">${pillowData.name}</h2>
        <div class="pillow-quote">"${pillowData.quote}"</div>
        <p class="pillow-desc">A legendary soft anime dakimakura! Mr. Geil will definitely find this pleasing.</p>
      </div>
    `;
    modal.style.display = 'block';

    setTimeout(() => {
      modal.style.display = 'none';
    }, 3200);
  }

  updateHUD() {
    const counter = document.getElementById('pillow-counter');
    if (counter) {
      counter.innerText = `${this.collectedCount} / ${this.requiredCount}`;
    }

    // Render thumbnail icons in HUD
    const list = document.getElementById('pillow-list');
    if (list) {
      list.innerHTML = '';
      this.inventory.forEach(item => {
        const icon = document.createElement('div');
        icon.className = 'hud-pillow-item';
        icon.title = `${item.name}: "${item.quote}"`;
        icon.innerText = '🌸';
        list.appendChild(icon);
      });
    }
  }

  isReadyForTribute() {
    return this.collectedCount >= this.requiredCount;
  }
}
