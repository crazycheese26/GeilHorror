// First-person controller.
//
// Two control schemes, chosen on the title screen:
//   mouse - pointer-locked mouse look, A/D strafe (standard FPS)
//   tank  - A/D turn the camera, no mouse look (the original scheme)
// Arrow keys always move and turn, so either scheme is keyboard-complete.
//
// Movement speed is also the stealth dial: sneaking is near-silent, sprinting
// can be heard across half the ship.

import { horrorAudio } from './audio.js';

const EYE_HEIGHT = 1.62;
const CROUCH_HEIGHT = 1.05;
const HIDDEN_HEIGHT = 0.85;

const SPEED = { sneak: 1.7, walk: 3.5, sprint: 6.2 };
// Full beam. The torch is dimmed to nothing rather than switched off, so this
// is the only place the lit value lives.
const TORCH_INTENSITY = 3.4;
// How far each gait carries in open air. Walls cut this roughly in half.
const NOISE_RADIUS = { still: 0, sneak: 3.5, walk: 13, sprint: 26 };

export class Player {
  constructor(camera, map, domElement, settings) {
    this.camera = camera;
    this.map = map;
    this.domElement = domElement;
    this.settings = settings;

    this.x = map.playerStart.x;
    this.z = map.playerStart.z;
    this.y = EYE_HEIGHT;
    this.yaw = -Math.PI / 2;
    this.pitch = 0;

    this.turnSpeed = 3.1;
    this.collisionRadius = 0.42;

    this.maxStamina = 100;
    this.stamina = this.maxStamina;
    this.staminaDrain = 24;
    this.staminaRegen = 16;
    this.regenDelay = 0;
    this.exhausted = false;

    this.gait = 'still';
    this.speed = 0;
    this.bobTimer = 0;

    // Off until the player throws the switch: the torch is a decision, not a
    // starting condition.
    this.flashlightOn = false;
    this.isHidden = false;
    this.hideSpot = null;
    this.oneShotNoise = 0;

    this.enabled = false;
    this.pointerLocked = false;

    this.keys = {
      forward: false, backward: false,
      left: false, right: false,
      turnLeft: false, turnRight: false,
      sprint: false, sneak: false
    };

    this.interactHeld = false;
    this.interactPressed = false;
    this.hideTogglePressed = false;

    this.camera.rotation.order = 'YXZ';
    this.setupFlashlight();
    this.bindInput();
    this.syncCamera();
  }

  // --- Flashlight ------------------------------------------------------

  setupFlashlight() {
    this.flashlight = new THREE.SpotLight(0xffe9cc, 0, 32, Math.PI / 5.4, 0.55, 1.5);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.width = 1024;
    this.flashlight.shadow.mapSize.height = 1024;
    this.flashlight.shadow.camera.near = 0.4;
    this.flashlight.shadow.camera.far = 32;
    this.flashlight.shadow.bias = -0.0018;
    this.flashlight.position.set(0.22, -0.16, 0);
    // Never hidden — see setFlashlight. It is in the scene from the first frame
    // so every material compiles once, with the torch already accounted for.
    this.flashlight.visible = true;
    this.setFlashlight(this.flashlightOn, true);

    this.flashlightTarget = new THREE.Object3D();
    this.flashlightTarget.position.set(0, 0, -6);
    this.flashlight.target = this.flashlightTarget;

    this.camera.add(this.flashlight);
    this.camera.add(this.flashlightTarget);

    // Lagged aim so the beam swings behind the view like a held torch.
    this.beamSway = { x: 0, y: 0 };
  }

  // silent skips the switch sound, for setting a run up rather than the player
  // actually thumbing the torch.
  //
  // The beam is dimmed, not hidden. Hiding a shadow-casting light takes it out
  // of the renderer's lighting state, that changes the program cache key, and
  // every shader in the scene recompiles — a hitch on every press of F, in a
  // game where the torch goes on and off constantly. Leaving the light in the
  // state and moving its intensity keeps the compiled programs; parking the
  // shadow pass while it is dark keeps an unlit torch costing nothing.
  setFlashlight(on, silent = false) {
    this.flashlightOn = on;
    this.flashlight.intensity = on ? TORCH_INTENSITY : 0;
    const shadow = this.flashlight.shadow;
    if (shadow) {
      shadow.autoUpdate = on;
      // Redraw on the frame it comes back on, not the frame after.
      if (on) shadow.needsUpdate = true;
    }
    if (!silent) horrorAudio.playClick();
  }

  toggleFlashlight() {
    this.setFlashlight(!this.flashlightOn);
  }

  // --- Input -----------------------------------------------------------

  bindInput() {
    this.onKeyDown = (e) => {
      if (!this.enabled) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      switch (k) {
        case 'w': case 'ArrowUp': this.keys.forward = true; break;
        case 's': case 'ArrowDown': this.keys.backward = true; break;
        case 'a': this.setLeft(true); break;
        case 'd': this.setRight(true); break;
        case 'ArrowLeft': this.keys.turnLeft = true; break;
        case 'ArrowRight': this.keys.turnRight = true; break;
        case 'Shift': this.keys.sprint = true; break;
        // Not Ctrl: the browser eats Ctrl+W before the page ever sees it.
        case 'c': this.keys.sneak = true; break;
        case 'f':
          if (!e.repeat) this.toggleFlashlight();
          break;
        case 'e': case ' ':
          if (!e.repeat) {
            this.interactPressed = true;
            this.hideTogglePressed = true;
          }
          this.interactHeld = true;
          e.preventDefault();
          break;
      }
    };

    this.onKeyUp = (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      switch (k) {
        case 'w': case 'ArrowUp': this.keys.forward = false; break;
        case 's': case 'ArrowDown': this.keys.backward = false; break;
        case 'a': this.setLeft(false); break;
        case 'd': this.setRight(false); break;
        case 'ArrowLeft': this.keys.turnLeft = false; break;
        case 'ArrowRight': this.keys.turnRight = false; break;
        case 'Shift': this.keys.sprint = false; break;
        case 'c': this.keys.sneak = false; break;
        case 'e': case ' ': this.interactHeld = false; break;
      }
    };

    // Bound to the canvas, not the window, so HUD buttons never count as
    // an interact press.
    this.onMouseDown = (e) => {
      if (!this.enabled || e.button !== 0) return;
      if (this.settings.controlScheme === 'mouse' && !this.pointerLocked) {
        this.requestPointerLock();
        return;
      }
      this.interactPressed = true;
      this.hideTogglePressed = true;
      this.interactHeld = true;
    };

    this.onMouseUp = () => { this.interactHeld = false; };

    this.onMouseMove = (e) => {
      if (!this.enabled || !this.pointerLocked) return;
      if (this.settings.controlScheme !== 'mouse') return;
      const sens = 0.0016 * this.settings.sensitivity;
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens;
      this.clampPitch();
    };

    this.onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.domElement;
      if (this.onLockChange) this.onLockChange(this.pointerLocked);
    };

    // Losing focus must not leave a key stuck down.
    this.onBlur = () => this.releaseAllKeys();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.domElement.addEventListener('mousedown', this.onMouseDown);
  }

  // A/D means strafe under mouse look and turn under tank controls.
  setLeft(down) {
    if (this.settings.controlScheme === 'mouse') this.keys.left = down;
    else this.keys.turnLeft = down;
  }

  setRight(down) {
    if (this.settings.controlScheme === 'mouse') this.keys.right = down;
    else this.keys.turnRight = down;
  }

  releaseAllKeys() {
    for (const key of Object.keys(this.keys)) this.keys[key] = false;
    this.interactHeld = false;
  }

  requestPointerLock() {
    if (this.domElement.requestPointerLock) this.domElement.requestPointerLock();
  }

  exitPointerLock() {
    if (document.pointerLockElement === this.domElement && document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  clampPitch() {
    const limit = Math.PI * 0.42;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.releaseAllKeys();
  }

  // --- Simulation ------------------------------------------------------

  update(delta) {
    this.oneShotNoise = 0;

    if (this.isHidden) {
      this.updateHidden(delta);
      return;
    }

    if (this.keys.turnLeft) this.yaw += this.turnSpeed * delta;
    if (this.keys.turnRight) this.yaw -= this.turnSpeed * delta;

    let moveZ = 0;
    let moveX = 0;
    if (this.keys.forward) moveZ += 1;
    if (this.keys.backward) moveZ -= 1;
    if (this.keys.left) moveX -= 1;
    if (this.keys.right) moveX += 1;

    const isMoving = moveZ !== 0 || moveX !== 0;
    this.gait = this.resolveGait(isMoving, delta);
    this.speed = isMoving ? SPEED[this.gait] || 0 : 0;

    if (isMoving) {
      // Normalise so diagonals aren't faster.
      const len = Math.hypot(moveX, moveZ);
      moveX /= len;
      moveZ /= len;

      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // Forward is -Z in view space; right is +X.
      const dirX = -sin * moveZ + cos * moveX;
      const dirZ = -cos * moveZ - sin * moveX;

      const step = this.speed * delta;
      const resolved = this.map.resolveCollision(
        this.x, this.z,
        this.x + dirX * step, this.z + dirZ * step,
        this.collisionRadius
      );
      this.x = resolved.x;
      this.z = resolved.z;

      const bobFreq = this.gait === 'sprint' ? 12.5 : this.gait === 'sneak' ? 4.5 : 8.4;
      const prevBob = this.bobTimer;
      this.bobTimer += delta * bobFreq;

      // One footstep per bob trough.
      if (Math.floor(prevBob / Math.PI) !== Math.floor(this.bobTimer / Math.PI)) {
        horrorAudio.playFootstep(this.gait);
      }
    } else {
      // Settle the bob rather than freezing mid-swing.
      this.bobTimer += delta * 2.0;
    }

    this.syncCamera(delta);
  }

  resolveGait(isMoving, delta) {
    if (!isMoving) {
      this.recoverStamina(delta);
      return 'still';
    }
    if (this.keys.sneak) {
      this.recoverStamina(delta);
      return 'sneak';
    }
    if (this.keys.sprint && !this.exhausted && this.stamina > 0) {
      this.stamina = Math.max(0, this.stamina - this.staminaDrain * delta);
      this.regenDelay = 1.0;
      if (this.stamina <= 0) this.exhausted = true;
      return 'sprint';
    }
    this.recoverStamina(delta);
    return 'walk';
  }

  recoverStamina(delta) {
    if (this.regenDelay > 0) {
      this.regenDelay -= delta;
      return;
    }
    this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegen * delta);
    // Have to catch your breath properly before sprinting again.
    if (this.exhausted && this.stamina > 35) this.exhausted = false;
  }

  updateHidden(delta) {
    this.gait = 'still';
    this.speed = 0;
    this.recoverStamina(delta);
    this.bobTimer += delta * 1.6;

    // Any movement key breaks cover.
    if (this.keys.forward || this.keys.backward || this.keys.left || this.keys.right) {
      this.leaveHiding();
      return;
    }
    this.syncCamera(delta);
  }

  syncCamera(delta = 0) {
    const targetHeight = this.isHidden ? HIDDEN_HEIGHT
      : this.keys.sneak ? CROUCH_HEIGHT
        : EYE_HEIGHT;
    // Ease between stances instead of snapping.
    this.y += (targetHeight - this.y) * Math.min(1, delta * 9);

    const bobAmount = this.isHidden ? 0.012
      : this.gait === 'sprint' ? 0.052
        : this.gait === 'walk' ? 0.034
          : this.gait === 'sneak' ? 0.016
            : 0.006;
    const bobY = Math.sin(this.bobTimer) * bobAmount;
    const bobX = Math.cos(this.bobTimer * 0.5) * bobAmount * 0.6;

    this.camera.position.set(this.x + bobX * 0.3, this.y + bobY, this.z);
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.y = this.yaw;
    // A touch of roll when strafing sells the weight.
    this.camera.rotation.z = bobX * 0.35;

    if (delta > 0) {
      const lag = Math.min(1, delta * 6);
      this.beamSway.x += (0 - this.beamSway.x) * lag;
      this.beamSway.y += (0 - this.beamSway.y) * lag;
      this.flashlightTarget.position.set(this.beamSway.x, this.beamSway.y - 0.1, -6);
    }
  }

  // --- Stealth surface -------------------------------------------------

  // Radius at which Mr. Geil can hear this frame's movement.
  getNoiseRadius() {
    if (this.isHidden) return 0;
    return Math.max(NOISE_RADIUS[this.gait] || 0, this.oneShotNoise);
  }

  // A distinct, loud, one-frame sound: tearing paper, a dropped lid.
  emitNoise(radius) {
    this.oneShotNoise = Math.max(this.oneShotNoise, radius);
  }

  // Multiplier on how far away Mr. Geil can spot the player.
  getVisibilityFactor() {
    if (this.isHidden) return 0;
    let factor = 1;
    if (this.flashlightOn) factor *= 1.85;   // the beam gives you away
    // Crouching is a stance, not a gait. Reading the gait here meant a player
    // frozen behind a stack was as visible as one standing upright, even
    // though the camera was down and the cargo was already breaking his line
    // of sight — the one thing the game tells you to do was the one thing that
    // stopped working the moment you stopped moving.
    if (this.keys.sneak) factor *= 0.55;
    else if (this.gait === 'sprint') factor *= 1.25;
    return factor;
  }

  canHideAt(spot) {
    const dx = spot.x - this.x;
    const dz = spot.z - this.z;
    return dx * dx + dz * dz < 2.4 * 2.4;
  }

  enterHiding(spot) {
    this.isHidden = true;
    this.hideSpot = spot;
    this.releaseAllKeys();
    horrorAudio.playRustle();
  }

  leaveHiding() {
    this.isHidden = false;
    this.hideSpot = null;
    horrorAudio.playRustle();
  }

  // --- Accessors -------------------------------------------------------

  getPosition() {
    return { x: this.x, y: this.y, z: this.z };
  }

  getForward() {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  setPosition(x, z) {
    this.x = x;
    this.z = z;
    this.syncCamera();
  }

  reset() {
    this.setPosition(this.map.playerStart.x, this.map.playerStart.z);
    this.y = EYE_HEIGHT;
    this.yaw = -Math.PI / 2;
    this.pitch = 0;
    this.stamina = this.maxStamina;
    this.exhausted = false;
    this.regenDelay = 0;
    this.isHidden = false;
    this.hideSpot = null;
    this.gait = 'still';
    this.bobTimer = 0;
    this.setFlashlight(false, true);
    this.releaseAllKeys();
    this.syncCamera();
  }

  // Consume the edge-triggered interact flag.
  consumeInteract() {
    const pressed = this.interactPressed;
    this.interactPressed = false;
    return pressed;
  }

  consumeHideToggle() {
    const pressed = this.hideTogglePressed;
    this.hideTogglePressed = false;
    return pressed;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.domElement.removeEventListener('mousedown', this.onMouseDown);
  }
}
