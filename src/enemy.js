// Mr. Geil Enemy AI: Stalks through the dark corridors to eat you and become EXTRA GEIL!
// Uses the original uploaded sketch as an animated 3D horror entity with corridor pathfinding

import { horrorAudio } from './audio.js';

export class GeilEnemy {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;

    // Dimensions & Transform
    this.width = 3.6;
    this.height = 2.4;

    // Starting Position: Open corridor tile (Col 7, Row 5) ~25m from player start
    this.x = 7 * map.cellSize;
    this.z = 5 * map.cellSize;
    this.y = 1.6;

    // Movement & AI
    this.speed = 2.8;
    this.chaseSpeed = 4.6;
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
    // Load original monster drawing
    const textureLoader = new THREE.TextureLoader();
    const monsterTexture = textureLoader.load('assets/geil_original.png');
    monsterTexture.magFilter = THREE.LinearFilter;
    monsterTexture.minFilter = THREE.LinearFilter;

    // 3D Billboard Quad displaying the original sketch
    const planeGeo = new THREE.PlaneGeometry(this.width, this.height);
    const planeMat = new THREE.MeshBasicMaterial({
      map: monsterTexture,
      side: THREE.DoubleSide
    });

    this.sprite = new THREE.Mesh(planeGeo, planeMat);
    this.sprite.position.set(this.x, this.y, this.z);
    this.scene.add(this.sprite);

    // Ominous deep red glow aura that casts red light onto corridor walls
    this.glowLight = new THREE.PointLight(0xff1122, 2.8, 16);
    this.glowLight.position.set(this.x, this.y, this.z);
    this.scene.add(this.glowLight);
  }

  pickNewWaypoint() {
    const tile = this.map.getRandomWalkableTile();
    if (tile) {
      this.targetWaypoint = { x: tile.x, z: tile.z };
    }
    this.changeTargetTimer = 4 + Math.random() * 6;
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
    if (distToPlayer < 20 && now - this.lastGrowlTime > 5) {
      horrorAudio.playMonsterGrowl();
      this.lastGrowlTime = now + Math.random() * 3;
    }

    // AI State Machine
    if (distToPlayer < 10.0) {
      this.state = 'CHASE';
    } else if (distToPlayer < 28.0) {
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
      moveSpeed = this.speed * 1.35;
    } else {
      // PATROL: actively wanders the corridors
      this.changeTargetTimer -= delta;
      if (this.changeTargetTimer <= 0 || !this.targetWaypoint) {
        this.pickNewWaypoint();
      }
      targetX = this.targetWaypoint.x;
      targetZ = this.targetWaypoint.z;
    }

    // Use corridor pathfinding (BFS) so Mr. Geil never gets stuck on walls
    let nextStep = { x: targetX, z: targetZ };
    if (distToPlayer > 1.8) {
      nextStep = this.map.findPathNextStep(this.x, this.z, targetX, targetZ);
    }

    const toStepX = nextStep.x - this.x;
    const toStepZ = nextStep.z - this.z;
    const distToStep = Math.sqrt(toStepX * toStepX + toStepZ * toStepZ);

    if (distToStep > 0.1) {
      const step = (moveSpeed * delta) / distToStep;
      const desiredX = this.x + toStepX * Math.min(step, 1.0);
      const desiredZ = this.z + toStepZ * Math.min(step, 1.0);

      const resolved = this.map.resolveCollision(this.x, this.z, desiredX, desiredZ, 0.6);
      this.x = resolved.x;
      this.z = resolved.z;
    }

    // Animate sprite: billboard faces camera, slight wobble and breathing scale
    const wobbleY = Math.sin(this.wobbleTime) * 0.12;
    const tiltZ = Math.sin(this.wobbleTime * 0.7) * 0.12;
    const pulseScale = 1.0 + Math.sin(this.wobbleTime * 2) * 0.04;

    this.sprite.position.set(this.x, this.y + wobbleY, this.z);
    this.sprite.rotation.set(0, 0, 0);
    // Face player
    this.sprite.lookAt(playerPos.x, this.y, playerPos.z);
    this.sprite.rotation.z = tiltZ;
    this.sprite.scale.set(pulseScale, pulseScale, 1);

    // Glow light follows
    if (this.glowLight) {
      this.glowLight.position.set(this.x, this.y + wobbleY, this.z);
      this.glowLight.intensity = this.state === 'CHASE' ? 3.5 : 2.0 + Math.sin(this.wobbleTime * 3) * 0.6;
    }

    // Catch condition: Mr. Geil eats you!
    if (this.isDeadly && distToPlayer < 1.4) {
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

    if (dist < 20.0) {
      const intensity = Math.min(1.0, 1.0 - (dist / 20.0));
      vignette.style.opacity = (intensity * 0.85).toFixed(2);
      if (staticOverlay) {
        staticOverlay.style.opacity = (0.05 + intensity * 0.3).toFixed(2);
      }

      if (dist < 12.0 && geilWarning) {
        geilWarning.style.display = 'block';
        geilWarning.innerText = "⚠️ MR. GEIL IS EXTREMELY CLOSE! HE WANTS TO EAT YOU!";
      } else if (geilWarning) {
        geilWarning.style.display = 'none';
      }
    } else {
      vignette.style.opacity = '0';
      if (staticOverlay) staticOverlay.style.opacity = '0.05';
      if (geilWarning) geilWarning.style.display = 'none';
    }
  }

  resetPosition() {
    this.x = 7 * this.map.cellSize;
    this.z = 5 * this.map.cellSize;
    this.state = 'PATROL';
    this.isDeadly = true;
    this.pickNewWaypoint();
  }

  pacify() {
    this.isDeadly = false;
    this.state = 'PACIFIED';
    if (this.glowLight) {
      this.glowLight.color.setHex(0xffdd66); // Golden warm satisfied aura!
      this.glowLight.intensity = 4.0;
    }
  }
}
