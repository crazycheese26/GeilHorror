// Player First-Person Controller with Tank/FPS Keyboard Turning & Flashlight
// Strict requirement: W/S forward/back, A/D turn camera left/right, Arrow keys parity

import { horrorAudio } from './audio.js';

export class Player {
  constructor(camera, map, domElement) {
    this.camera = camera;
    this.map = map;
    this.domElement = domElement;

    // Position & Orientation
    this.x = map.playerStart.x;
    this.z = map.playerStart.z;
    this.y = 1.6; // Eye level
    this.yaw = -Math.PI / 2; // Face down the illuminated corridor towards the ship hold
    this.pitch = 0; // Look up/down (clamped)

    this.walkSpeed = 4.2; // meters/sec
    this.sprintMultiplier = 1.65;
    this.turnSpeed = 2.2; // radians/sec
    this.collisionRadius = 0.55;

    // Stamina System
    this.stamina = 100;
    this.maxStamina = 100;
    this.staminaDrain = 28; // per second
    this.staminaRegen = 22; // per second

    // Head bobbing
    this.bobTimer = 0;
    this.bobIntensity = 0.045;

    // Keys State
    this.keys = {
      forward: false,
      backward: false,
      turnLeft: false,
      turnRight: false,
      sprint: false,
      interact: false
    };

    // Powerful Wide Flashlight (warm, clear beam without blinding glare)
    this.flashlight = new THREE.SpotLight(0xfff5e6, 2.0, 36, Math.PI / 3.0, 0.45, 1.2);
    this.flashlightTarget = new THREE.Object3D();

    this.setupFlashlight();

    // Interaction Raycasting
    this.interactionPrompt = null;
    this.interactCallback = null;

    this.setupEventListeners();
    this.updateCameraTransform();
  }

  setupFlashlight() {
    this.flashlight.position.set(0, 0, 0);
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlightTarget);
    this.flashlightTarget.position.set(0, 0, -5);
    this.flashlight.target = this.flashlightTarget;
  }

  setupEventListeners() {
    window.addEventListener('keydown', (e) => {
      horrorAudio.init(); // Initialize audio context on first user keypress

      const key = e.key.toLowerCase();
      if (key === 'w' || e.key === 'ArrowUp') this.keys.forward = true;
      if (key === 's' || e.key === 'ArrowDown') this.keys.backward = true;
      if (key === 'a' || e.key === 'ArrowLeft') this.keys.turnLeft = true;
      if (key === 'd' || e.key === 'ArrowRight') this.keys.turnRight = true;
      if (e.key === 'Shift') this.keys.sprint = true;
      if (key === 'e' || e.key === ' ' || e.key === 'enter') {
        this.keys.interact = true;
        if (this.interactCallback) this.interactCallback();
      }
    });

    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || e.key === 'ArrowUp') this.keys.forward = false;
      if (key === 's' || e.key === 'ArrowDown') this.keys.backward = false;
      if (key === 'a' || e.key === 'ArrowLeft') this.keys.turnLeft = false;
      if (key === 'd' || e.key === 'ArrowRight') this.keys.turnRight = false;
      if (e.key === 'Shift') this.keys.sprint = false;
      if (key === 'e' || e.key === ' ' || e.key === 'enter') this.keys.interact = false;
    });

    // Optional mouse-drag or mouse-click interaction
    let isMouseDown = false;
    let prevMouseX = 0;

    window.addEventListener('mousedown', (e) => {
      horrorAudio.init();
      if (e.button === 0) {
        isMouseDown = true;
        prevMouseX = e.clientX;
        if (this.interactCallback) this.interactCallback();
      }
    });

    window.addEventListener('mouseup', () => {
      isMouseDown = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (isMouseDown && document.pointerLockElement === this.domElement) {
        this.yaw -= e.movementX * 0.003;
        this.pitch -= e.movementY * 0.003;
        this.pitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.pitch));
      }
    });
  }

  update(delta) {
    // 1. Camera Turning: A/D and Left/Right Arrows
    if (this.keys.turnLeft) {
      this.yaw += this.turnSpeed * delta;
    }
    if (this.keys.turnRight) {
      this.yaw -= this.turnSpeed * delta;
    }

    // 2. Sprint & Stamina
    const isMoving = this.keys.forward || this.keys.backward;
    let currentSpeed = this.walkSpeed;

    if (this.keys.sprint && isMoving && this.stamina > 5) {
      currentSpeed *= this.sprintMultiplier;
      this.stamina = Math.max(0, this.stamina - this.staminaDrain * delta);
    } else {
      this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegen * delta);
    }

    // Update stamina UI bar
    const staminaBar = document.getElementById('stamina-fill');
    if (staminaBar) {
      staminaBar.style.width = `${(this.stamina / this.maxStamina) * 100}%`;
    }

    // 3. Movement: W/S and Up/Down Arrows
    let moveForward = 0;
    if (this.keys.forward) moveForward += 1;
    if (this.keys.backward) moveForward -= 1;

    if (moveForward !== 0) {
      // Calculate delta position based on camera yaw
      const forwardX = -Math.sin(this.yaw);
      const forwardZ = -Math.cos(this.yaw);

      const targetX = this.x + forwardX * moveForward * currentSpeed * delta;
      const targetZ = this.z + forwardZ * moveForward * currentSpeed * delta;

      // Collision resolution
      const resolved = this.map.resolveCollision(this.x, this.z, targetX, targetZ, this.collisionRadius);
      this.x = resolved.x;
      this.z = resolved.z;

      // Head bobbing & footstep audio
      const bobFreq = this.keys.sprint ? 14 : 9;
      this.bobTimer += delta * bobFreq;

      if (Math.sin(this.bobTimer) < -0.85) {
        horrorAudio.playFootstep();
      }
    }

    // 4. Update Camera Position & Rotation
    this.updateCameraTransform();
  }

  updateCameraTransform() {
    const bobOffset = Math.sin(this.bobTimer) * (this.keys.forward || this.keys.backward ? this.bobIntensity : 0);
    this.camera.position.set(this.x, this.y + bobOffset, this.z);

    // Camera rotation using Euler angles (YXZ order)
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  getPosition() {
    return { x: this.x, y: this.y, z: this.z };
  }

  setPosition(x, z) {
    this.x = x;
    this.z = z;
    this.updateCameraTransform();
  }

  onInteract(cb) {
    this.interactCallback = cb;
  }
}
