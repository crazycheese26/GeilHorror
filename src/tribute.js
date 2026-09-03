// Sacred Sinterklaas Tribute Altar & Escape Sequence
// Place 5 Anime Body Pillows on the altar to appease Mr. Geil!

import { TextureFactory } from './textures.js';
import { horrorAudio } from './audio.js';

export class TributeAltar {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.pos = map.altarLocation;

    this.group = new THREE.Group();
    this.isOffered = false;
    this.candles = [];
    this.altarMesh = null;
    this.altarLight = null;

    this.setupAltar();
  }

  setupAltar() {
    this.group.position.set(this.pos.x, 0, this.pos.z);

    // 1. Altar Pedestal (Stepped golden stone base)
    const baseGeo = new THREE.BoxGeometry(3.6, 0.4, 2.6);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1f1914,
      roughness: 0.8,
      metalness: 0.2
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.2;
    this.group.add(base);

    // 2. Velvet Offering Table
    const tableGeo = new THREE.BoxGeometry(3.2, 0.6, 2.2);
    const altarTex = TextureFactory.createAltarTexture();
    const tableMat = new THREE.MeshStandardMaterial({
      map: altarTex,
      roughness: 0.6,
      metalness: 0.3
    });
    this.altarMesh = new THREE.Mesh(tableGeo, tableMat);
    this.altarMesh.position.y = 0.7;
    this.group.add(this.altarMesh);

    // 3. Golden Sinterklaas Staf (Crozier) resting beside Altar
    const staffGroup = new THREE.Group();
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.6, 12);
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      metalness: 0.9,
      roughness: 0.2
    });
    const pole = new THREE.Mesh(poleGeo, goldMat);
    staffGroup.add(pole);

    // Staf curl
    const curlGeo = new THREE.TorusGeometry(0.24, 0.04, 12, 24, Math.PI * 1.5);
    const curl = new THREE.Mesh(curlGeo, goldMat);
    curl.position.set(0.18, 1.35, 0);
    staffGroup.add(curl);

    staffGroup.position.set(-1.8, 1.3, -0.8);
    staffGroup.rotation.z = -0.15;
    this.group.add(staffGroup);

    // 4. Ritual Candelabras (Candles on left and right)
    this.createCandle(-1.4, 1.05, 0.8);
    this.createCandle(-1.4, 1.05, -0.8);
    this.createCandle(1.4, 1.05, 0.8);
    this.createCandle(1.4, 1.05, -0.8);

    // 5. Altar Light
    this.altarLight = new THREE.PointLight(0xffaa33, 1.8, 8);
    this.altarLight.position.set(0, 1.8, 0);
    this.group.add(this.altarLight);

    this.scene.add(this.group);
  }

  createCandle(x, y, z) {
    const candleGroup = new THREE.Group();
    candleGroup.position.set(x, y, z);

    // Wax stick
    const waxGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.35, 8);
    const waxMat = new THREE.MeshStandardMaterial({ color: 0xfffae6, roughness: 0.9 });
    const wax = new THREE.Mesh(waxGeo, waxMat);
    candleGroup.add(wax);

    // Flame
    const flameGeo = new THREE.SphereGeometry(0.035, 6, 6);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.y = 0.2;
    flame.scale.set(1, 1.6, 1);
    candleGroup.add(flame);

    const candleLight = new THREE.PointLight(0xff7711, 0.6, 3.5);
    candleLight.position.y = 0.22;
    candleGroup.add(candleLight);

    this.group.add(candleGroup);
    this.candles.push({ flame, candleLight, baseIntensity: 0.6, phase: Math.random() * Math.PI });
  }

  update(delta, playerPos) {
    // Candle flicker
    const time = performance.now() / 1000;
    this.candles.forEach(c => {
      const flick = Math.sin(time * 10 + c.phase) * 0.15;
      c.candleLight.intensity = c.baseIntensity + flick;
    });

    // Distance check to player
    const dx = playerPos.x - this.pos.x;
    const dz = playerPos.z - this.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    return dist < 3.8;
  }

  // Offer the collected anime body pillows on the Altar!
  performTribute(itemManager, geilEnemy, onVictory) {
    if (this.isOffered) return;
    this.isOffered = true;

    // Place all collected body pillows neatly arranged on the velvet altar
    itemManager.inventory.forEach((pillowData, idx) => {
      const pillowGeo = new THREE.BoxGeometry(0.55, 1.1, 0.15);
      const sideMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
      const faceMat = new THREE.MeshStandardMaterial({
        map: pillowData.texture,
        roughness: 0.5
      });
      const pillowMaterials = [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat];
      const mesh = new THREE.Mesh(pillowGeo, pillowMaterials);

      // Lay down on the altar with slight rotation
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = (idx - 2) * 0.25;
      mesh.position.set((idx - 2) * 0.65, 1.08, 0);
      this.group.add(mesh);
    });

    // Divine golden beam of light
    this.altarLight.color.setHex(0xffdd44);
    this.altarLight.intensity = 6.0;
    this.altarLight.distance = 16.0;

    // Pacify Mr. Geil
    geilEnemy.pacify();
    geilEnemy.x = this.pos.x;
    geilEnemy.z = this.pos.z - 3.2;

    // Victory audio fanfare
    horrorAudio.playTributeSuccess();

    // Trigger victory sequence
    if (onVictory) {
      setTimeout(() => {
        onVictory();
      }, 1200);
    }
  }
}
