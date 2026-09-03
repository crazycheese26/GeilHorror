// Game loop, state machine, settings, and every DOM read/write. The simulation
// modules stay free of UI so they can be driven headlessly.

import { SteamboatMap } from './map.js';
import { Player } from './player.js';
import { GeilEnemy, STATE } from './enemy.js';
import { ItemManager } from './items.js';
import { TributeAltar } from './tribute.js';
import { TextureFactory } from './textures.js';
import { horrorAudio } from './audio.js';

const SETTINGS_KEY = 'geil.settings.v1';

const DEFAULT_SETTINGS = {
  controlScheme: 'mouse',
  brightness: 40,
  sensitivity: 1.0,
  volume: 75
};

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.state = 'MENU';
    this.settings = this.loadSettings();

    this.currentZone = null;
    this.zoneTimer = 0;
    this.toastTimer = 0;
    this.deathTimer = 0;

    this.cacheDom();
    this.initRenderer();
    this.initWorld();
    this.bindUI();
    this.applySettings();
    this.animate();
  }

  // --- Settings --------------------------------------------------------

  loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (err) {
      // Private browsing or blocked storage: defaults are fine.
    }
    return { ...DEFAULT_SETTINGS };
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch (err) { /* not worth interrupting play over */ }
  }

  applySettings() {
    this.renderer.toneMappingExposure = 0.5 + (this.settings.brightness / 100) * 1.5;
    horrorAudio.setVolume(this.settings.volume / 100);

    for (const el of document.querySelectorAll('[data-scheme]')) {
      el.classList.toggle('is-active', el.dataset.scheme === this.settings.controlScheme);
    }
    document.body.dataset.scheme = this.settings.controlScheme;

    if (this.dom.brightness) this.dom.brightness.value = this.settings.brightness;
    if (this.dom.volume) this.dom.volume.value = this.settings.volume;
    if (this.dom.sensitivity) this.dom.sensitivity.value = Math.round(this.settings.sensitivity * 100);

    this.saveSettings();
  }

  cacheDom() {
    const $ = id => document.getElementById(id);
    this.dom = {
      hud: $('hud'),
      title: $('title-screen'),
      pause: $('pause-screen'),
      death: $('death-screen'),
      victory: $('victory-screen'),
      staminaFill: $('stamina-fill'),
      staminaWrap: $('stamina'),
      pillowCount: $('pillow-count'),
      pillowPips: $('pillow-pips'),
      prompt: $('prompt'),
      promptText: $('prompt-text'),
      promptFill: $('prompt-fill'),
      awarenessArc: $('awareness-arc'),
      awareness: $('awareness'),
      threatRing: $('threat-ring'),
      zone: $('zone-name'),
      toast: $('toast'),
      danger: $('danger-vignette'),
      hiddenMask: $('hidden-mask'),
      torch: $('torch-state'),
      objective: $('objective'),
      brightness: $('set-brightness'),
      volume: $('set-volume'),
      sensitivity: $('set-sensitivity'),
      sensRow: $('sens-row'),
      deathReason: $('death-reason')
    };
  }

  // --- Boot ------------------------------------------------------------

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 120);
    this.scene.add(this.camera);

    this.clock = new THREE.Clock();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  initWorld() {
    // Must be set before the first texture is built, and the map builds them
    // all in its constructor.
    const caps = this.renderer.capabilities;
    if (caps && caps.getMaxAnisotropy) {
      TextureFactory.maxAnisotropy = Math.min(8, caps.getMaxAnisotropy());
    }

    this.map = new SteamboatMap(this.scene);
    this.player = new Player(this.camera, this.map, this.canvas, this.settings);
    this.enemy = new GeilEnemy(this.scene, this.map);
    this.items = new ItemManager(this.scene, this.map);
    this.altar = new TributeAltar(this.scene, this.map);

    this.items.onUnwrapped = (pillow, x, z, radius) => {
      this.showToast(pillow.name, pillow.quote);
      this.enemy.hearNoiseAt(x, z, radius / 30);
      this.enemy.setTier(this.items.collectedCount);
      this.updateObjective();
      this.renderPips();
    };

    this.player.onLockChange = (locked) => {
      if (!locked && this.state === 'PLAYING' && this.settings.controlScheme === 'mouse') {
        this.pause();
      }
    };
  }

  bindUI() {
    const on = (id, ev, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };

    on('btn-start', 'click', () => this.startGame());
    on('btn-resume', 'click', () => this.resume());
    on('btn-quit', 'click', () => this.toMenu());
    on('btn-retry', 'click', () => this.restart());
    on('btn-play-again', 'click', () => this.restart());

    for (const el of document.querySelectorAll('[data-scheme]')) {
      el.addEventListener('click', () => {
        this.settings.controlScheme = el.dataset.scheme;
        this.player.releaseAllKeys();
        this.applySettings();
      });
    }

    on('set-brightness', 'input', (e) => {
      this.settings.brightness = Number(e.target.value);
      this.applySettings();
    });
    on('set-volume', 'input', (e) => {
      this.settings.volume = Number(e.target.value);
      this.applySettings();
    });
    on('set-sensitivity', 'input', (e) => {
      this.settings.sensitivity = Number(e.target.value) / 100;
      this.applySettings();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.state === 'PLAYING') this.pause();
        else if (this.state === 'PAUSED') this.resume();
      }
    });
  }

  // --- State transitions -----------------------------------------------

  show(el, visible) {
    if (el) el.classList.toggle('is-visible', visible);
  }

  startGame() {
    horrorAudio.init();
    horrorAudio.resume();

    this.show(this.dom.title, false);
    this.show(this.dom.pause, false);
    this.show(this.dom.death, false);
    this.show(this.dom.victory, false);
    this.show(this.dom.hud, true);

    this.state = 'PLAYING';
    this.player.setEnabled(true);
    if (this.settings.controlScheme === 'mouse') this.player.requestPointerLock();

    this.currentZone = null;
    this.updateObjective();
    this.renderPips();
    this.clock.getDelta();
  }

  pause() {
    if (this.state !== 'PLAYING') return;
    this.state = 'PAUSED';
    this.player.setEnabled(false);
    this.player.exitPointerLock();
    horrorAudio.setThreat(0);
    this.show(this.dom.pause, true);
  }

  resume() {
    if (this.state !== 'PAUSED') return;
    this.show(this.dom.pause, false);
    this.state = 'PLAYING';
    this.player.setEnabled(true);
    if (this.settings.controlScheme === 'mouse') this.player.requestPointerLock();
    this.clock.getDelta();
  }

  toMenu() {
    this.resetRun();
    this.state = 'MENU';
    this.player.setEnabled(false);
    this.player.exitPointerLock();
    this.show(this.dom.pause, false);
    this.show(this.dom.hud, false);
    this.show(this.dom.title, true);
  }

  restart() {
    this.resetRun();
    this.startGame();
  }

  resetRun() {
    this.items.dispose();
    this.items = new ItemManager(this.scene, this.map);
    this.items.onUnwrapped = (pillow, x, z, radius) => {
      this.showToast(pillow.name, pillow.quote);
      this.enemy.hearNoiseAt(x, z, radius / 30);
      this.enemy.setTier(this.items.collectedCount);
      this.updateObjective();
      this.renderPips();
    };

    this.altar.reset();
    this.player.reset();
    this.enemy.reset();

    horrorAudio.setThreat(0);
    this.show(this.dom.death, false);
    this.show(this.dom.victory, false);
    this.show(this.dom.danger, false);
    this.show(this.dom.hiddenMask, false);
    this.deathTimer = 0;
  }

  triggerDeath() {
    if (this.state !== 'PLAYING') return;
    this.state = 'DEAD';
    this.deathTimer = 0;

    // Snap the view onto him so the last frame is his face.
    this.player.yaw = Math.atan2(this.enemy.x - this.player.x, this.enemy.z - this.player.z) + Math.PI;
    this.player.pitch = 0;
    this.player.syncCamera();
    this.player.setEnabled(false);
    this.player.exitPointerLock();

    horrorAudio.playJumpscare();

    if (this.dom.deathReason) {
      this.dom.deathReason.textContent = this.player.isHidden
        ? 'He knew. He looked in the crate.'
        : 'He found you.';
    }
    this.show(this.dom.hud, false);
    this.show(this.dom.death, true);
    document.body.classList.add('is-dying');
    setTimeout(() => document.body.classList.remove('is-dying'), 900);
  }

  triggerVictory() {
    if (this.state !== 'PLAYING') return;
    this.state = 'VICTORY';
    this.player.setEnabled(false);
    this.player.exitPointerLock();
    horrorAudio.setThreat(0);
    this.show(this.dom.hud, false);
    this.show(this.dom.victory, true);
  }

  // --- Simulation ------------------------------------------------------

  update(delta) {
    if (this.state !== 'PLAYING') return;

    this.player.update(delta);
    const pos = this.player.getPosition();

    this.map.update(delta, this.clock.elapsedTime, pos);

    const interactPressed = this.player.consumeInteract();
    const interactHeld = this.player.interactHeld;

    const altarState = this.altar.update(delta, pos, interactHeld, this.items);
    const canOpenPresents = !this.player.isHidden && !altarState.canOffer;
    const itemState = this.items.update(delta, pos, interactHeld, canOpenPresents);

    this.handleHiding(interactPressed, pos, itemState, altarState);

    if (altarState.canOffer && altarState.progress >= 1 && !this.altar.isOffered) {
      this.altar.complete(this.enemy);
      setTimeout(() => this.triggerVictory(), 1400);
    }

    this.enemy.update(delta, this.player, () => this.triggerDeath());

    this.updateHud(pos, itemState, altarState);
    this.updateZone(pos, delta);
  }

  handleHiding(pressed, pos, itemState, altarState) {
    if (!pressed) return;

    if (this.player.isHidden) {
      this.player.leaveHiding();
      return;
    }
    // Opening a present or the altar takes priority over ducking into cover.
    if (itemState.target || altarState.canOffer) return;

    for (const spot of this.map.hidingSpots) {
      if (this.player.canHideAt(spot)) {
        this.player.enterHiding(spot);
        return;
      }
    }
  }

  // --- HUD -------------------------------------------------------------

  updateHud(pos, itemState, altarState) {
    const d = this.dom;

    const staminaPct = (this.player.stamina / this.player.maxStamina) * 100;
    if (d.staminaFill) d.staminaFill.style.width = `${staminaPct}%`;
    if (d.staminaWrap) {
      d.staminaWrap.classList.toggle('is-spent', this.player.exhausted);
      d.staminaWrap.classList.toggle('is-full', staminaPct > 99);
    }

    if (d.pillowCount) d.pillowCount.textContent = String(this.items.collectedCount);
    if (d.torch) d.torch.classList.toggle('is-off', !this.player.flashlightOn);

    this.updatePrompt(itemState, altarState);
    this.updateAwareness(pos);
  }

  updatePrompt(itemState, altarState) {
    const d = this.dom;
    if (!d.prompt) return;

    let text = null;
    let progress = 0;

    if (this.player.isHidden) {
      text = 'Hidden — [E] to climb out';
    } else if (altarState.canOffer) {
      text = 'Hold [E] to lay out the five offerings';
      progress = altarState.progress;
    } else if (altarState.inRange && !this.altar.isOffered) {
      const left = this.items.remaining();
      text = `The altar wants five anime body pillows — ${left} still missing`;
    } else if (itemState.target) {
      text = 'Hold [E] to tear the pakje open';
      progress = itemState.progress;
    } else {
      for (const spot of this.map.hidingSpots) {
        if (this.player.canHideAt(spot)) {
          text = 'Press [E] to hide behind the crate';
          break;
        }
      }
    }

    d.prompt.classList.toggle('is-visible', text !== null);
    if (text !== null && d.promptText) d.promptText.textContent = text;
    if (d.promptFill) d.promptFill.style.transform = `scaleX(${progress})`;
  }

  updateAwareness(pos) {
    const d = this.dom;
    const a = this.enemy.awareness;
    const chasing = this.enemy.state === STATE.CHASE;

    if (d.awareness) {
      d.awareness.classList.toggle('is-visible', a > 0.04);
      d.awareness.classList.toggle('is-caught', chasing);
    }
    if (d.awarenessArc) {
      // 2*pi*r for r=15 is ~94.2; fill the ring clockwise from the top.
      d.awarenessArc.style.strokeDasharray = `${(a * 94.2).toFixed(1)} 94.2`;
    }

    // Directional tell, only once he is genuinely onto you.
    if (d.threatRing) {
      const showRing = a > 0.4 || chasing;
      d.threatRing.classList.toggle('is-visible', showRing);
      if (showRing) {
        const toX = this.enemy.x - pos.x;
        const toZ = this.enemy.z - pos.z;
        const yaw = this.player.yaw;
        const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
        const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
        const bearing = Math.atan2(
          toX * right.x + toZ * right.z,
          toX * fwd.x + toZ * fwd.z
        );
        d.threatRing.style.transform = `translate(-50%, -50%) rotate(${bearing}rad)`;
        d.threatRing.style.opacity = String(Math.min(1, 0.35 + a * 0.65));
      }
    }

    if (d.danger) {
      const intensity = chasing ? 1 : Math.max(0, (a - 0.35) / 0.65);
      d.danger.style.opacity = (intensity * 0.75).toFixed(2);
    }
    if (d.hiddenMask) {
      d.hiddenMask.classList.toggle('is-visible', this.player.isHidden);
    }
  }

  updateZone(pos, delta) {
    const zone = this.map.zoneAt(pos.x, pos.z);
    if (zone !== this.currentZone) {
      this.currentZone = zone;
      if (this.dom.zone) {
        this.dom.zone.textContent = this.map.zoneName(zone);
        this.dom.zone.classList.add('is-visible');
      }
      this.zoneTimer = 2.6;
    } else if (this.zoneTimer > 0) {
      this.zoneTimer -= delta;
      if (this.zoneTimer <= 0 && this.dom.zone) {
        this.dom.zone.classList.remove('is-visible');
      }
    }

    if (this.toastTimer > 0) {
      this.toastTimer -= delta;
      if (this.toastTimer <= 0 && this.dom.toast) {
        this.dom.toast.classList.remove('is-visible');
      }
    }
  }

  updateObjective() {
    if (!this.dom.objective) return;
    const left = this.items.remaining();
    this.dom.objective.textContent = left > 0
      ? `Find ${left} more anime body pillow${left === 1 ? '' : 's'}`
      : 'Carry them to the altar in het ruim';
    this.dom.objective.classList.toggle('is-done', left === 0);
  }

  renderPips() {
    if (!this.dom.pillowPips) return;
    this.dom.pillowPips.innerHTML = '';
    for (let i = 0; i < this.items.requiredCount; i++) {
      const pip = document.createElement('span');
      pip.className = 'pip' + (i < this.items.collectedCount ? ' is-filled' : '');
      this.dom.pillowPips.appendChild(pip);
    }
  }

  showToast(name, quote) {
    if (!this.dom.toast) return;
    this.dom.toast.innerHTML = '';

    const heading = document.createElement('strong');
    heading.textContent = name;
    const line = document.createElement('em');
    line.textContent = `"${quote}"`;

    this.dom.toast.append(heading, line);
    this.dom.toast.classList.add('is-visible');
    this.toastTimer = 2.8;
  }

  // --- Loop ------------------------------------------------------------

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.update(delta);

    // The camera keeps drifting toward him on the death screen.
    if (this.state === 'DEAD') {
      this.deathTimer += delta;
      const shake = Math.max(0, 0.5 - this.deathTimer) * 0.14;
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
      this.enemy.updateVisual(delta, this.player, this.enemy.distToPlayer);
    }

    this.renderer.render(this.scene, this.camera);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (typeof THREE === 'undefined') {
    document.body.innerHTML =
      '<div class="fatal">Three.js could not load. Serve this folder over HTTP ' +
      '(<code>python3 -m http.server</code>) and reload.</div>';
    return;
  }
  new Game();
});
