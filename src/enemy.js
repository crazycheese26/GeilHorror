// Mr. Geil Enemy AI: Stalks through the dark corridors to eat you and become EXTRA GEIL!
// Uses the user's sketch as an eerie animated 3D billboard sprite with glowing eyes

import { horrorAudio } from './audio.js';

export class GeilEnemy {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;

    // Dimensions & Transform
    this.width = 3.2;
    this.height = 2.2;
    this.x = 18 * map.cellSize;
    this.z = 18 * map.cellSize;
    this.y = 1.6;

    // Movement & AI
    this.speed = 2.4;
    this.chaseSpeed = 4.2;
    this.state = 'PATROL'; // PATROL, STALK, CHASE
    this.targetWaypoint = null;
    this.changeTargetTimer = 0;
    this.lastGrowlTime = 0;

    // Visuals & Animation
    this.sprite = null;
    this.glowLight = null;
    this.wobbleTime = 0;
    this.isDeadly = true;

    this.buildSprite();
    this.pickNewWaypoint();
  }

  buildSprite() {
    // Load monster texture
    const textureLoader = new THREE.TextureLoader();
    const monsterTexture = textureLoader.load('assets/geil_monster.png');
    monsterTexture.magFilter = THREE.LinearFilter;
    monsterTexture.minFilter = THREE.LinearFilter;

    // Billboard Quad
    const planeGeo = new THREE.PlaneGeometry(this.width, this.height);
    const planeMat = new THREE.MeshBasicMaterial({
      map: monsterTexture,
      transparent: true,
      side: THREE.DoubleSide,
      alphaTest: 0.15
    });

    this.sprite = new THREE.Mesh(planeGeo, planeMat);
    this.sprite.position.set(this.x, this.y, this.z);
    this.scene.add(this.sprite);

    // Ominous deep red glow aura
    this.glowLight = new THREE.PointLight(0xff1122, 1.8, 8);
    this.glowLight.position.set(this.x, this.y, this.z);
    this.scene.add(this.glowLight);
  }

  pickNewWaypoint() {
    const tile = this.map.getRandomWalkableTile();
    if (tile) {
      this.targetWaypoint = { x: tile.x, z: tile.z };
    }
    this.changeTargetTimer = 5 + Math.random() * 8;
  }

  update(delta, playerPos, onCatchPlayer) {
    if (!this.sprite) return;

    this.wobbleTime += delta * 4;

    // Distance to player
    const dx = playerPos.x - this.x;
    const dz = playerPos.z - this.z;
    const distToPlayer = Math.sqrt(dx * dx + dz * dz);

    // Update horror audio heartbeat
    horrorAudio.updateHeartbeat(distToPlayer);

    // Update screen horror vignette based on proximity
    this.updateHorrorVignette(distToPlayer);

    // Periodic eerie breathing / growl when relatively close
    const now = performance.now() / 1000;
    if (distToPlayer < 16 && now - this.lastGrowlTime > 6) {
      horrorAudio.playMonsterGrowl();
      this.lastGrowlTime = now + Math.random() * 3;
    }

    // AI State Machine
    if (distToPlayer < 7.0) {
      this.state = 'CHASE';
    } else if (distToPlayer < 18.0) {
      this.state = 'STALK';
    } else {
      this.state = 'PATROL';
    }

    let targetX = 0;
    let targetZ = 0;
    let moveSpeed = this.speed;

    if (this.state === 'CHASE') {
      targetX = playerPos.x;
      targetZ = playerPos.z;
      moveSpeed = this.chaseSpeed;
    } else if (this.state === 'STALK') {
      targetX = playerPos.x;
      targetZ = playerPos.z;
      moveSpeed = this.speed * 1.25;
    } else {
      // PATROL
      this.changeTargetTimer -= delta;
      if (this.changeTargetTimer <= 0 || !this.targetWaypoint) {
        this.pickNewWaypoint();
      }
      targetX = this.targetWaypoint.x;
      targetZ = this.targetWaypoint.z;
    }

    // Move towards target
    const toTargetX = targetX - this.x;
    const toTargetZ = targetZ - this.z;
    const distToTarget = Math.sqrt(toTargetX * toTargetX + toTargetZ * toTargetZ);

    if (distToTarget > 0.3) {
      const step = (moveSpeed * delta) / distToTarget;
      const desiredX = this.x + toTargetX * step;
      const desiredZ = this.z + toTargetZ * step;

      const resolved = this.map.resolveCollision(this.x, this.z, desiredX, desiredZ, 0.7);
      this.x = resolved.x;
      this.z = resolved.z;
    }

    // Animate sprite: billboard faces camera, slight head tilt and breathing scale
    const wobbleY = Math.sin(this.wobbleTime) * 0.12;
    const tiltZ = Math.sin(this.wobbleTime * 0.7) * 0.15;
    const pulseScale = 1.0 + Math.sin(this.wobbleTime * 2) * 0.05;

    this.sprite.position.set(this.x, this.y + wobbleY, this.z);
    this.sprite.rotation.set(0, 0, 0);
    // Face player
    this.sprite.lookAt(playerPos.x, this.y, playerPos.z);
    this.sprite.rotation.z = tiltZ;
    this.sprite.scale.set(pulseScale, pulseScale, 1);

    // Glow light follows
    if (this.glowLight) {
      this.glowLight.position.set(this.x, this.y + wobbleY, this.z);
      this.glowLight.intensity = this.state === 'CHASE' ? 3.0 : 1.5 + Math.sin(this.wobbleTime * 3) * 0.5;
    }

    // Catch condition: Mr. Geil eats you!
    if (this.isDeadly && distToPlayer < 1.35) {
      if (onCatchPlayer) {
        onCatchPlayer();
      }
    }
  }

  updateHorrorVignette(dist) {
    const vignette = document.getElementById('horror-vignette');
    const staticOverlay = document.getElementById('static-overlay');
    const geilWarning = document.getElementById('geil-warning');

    if (!vignette) return;

    if (dist < 18.0) {
      const intensity = Math.min(1.0, 1.0 - (dist / 18.0));
      vignette.style.opacity = (intensity * 0.85).toFixed(2);
      if (staticOverlay) {
        staticOverlay.style.opacity = (intensity * 0.45).toFixed(2);
      }

      if (dist < 8.0 && geilWarning) {
        geilWarning.style.display = 'block';
        geilWarning.innerText = "⚠️ MR. GEIL IS EXTREMELY CLOSE! HE WANTS TO EAT YOU!";
      } else if (geilWarning) {
        geilWarning.style.display = 'none';
      }
    } else {
      vignette.style.opacity = '0';
      if (staticOverlay) staticOverlay.style.opacity = '0';
      if (geilWarning) geilWarning.style.display = 'none';
    }
  }

  resetPosition() {
    this.x = 18 * this.map.cellSize;
    this.z = 18 * this.map.cellSize;
    this.state = 'PATROL';
    this.isDeadly = true;
    this.pickNewWaypoint();
  }

  pacify() {
    this.isDeadly = false;
    this.state = 'PACIFIED';
    if (this.glowLight) {
      this.glowLight.color.setHex(0xffdd66); // Golden warm satisfied aura!
      this.glowLight.intensity = 3.5;
    }
  }
}
