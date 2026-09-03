// "Geil the Game" - Main Orchestrator & Game Loop
// 3D First-Person Horror Game set in Sinterklaas' Steamboat Corridors

import { SteamboatMap } from './map.js';
import { Player } from './player.js';
import { GeilEnemy } from './enemy.js';
import { ItemManager } from './items.js';
import { TributeAltar } from './tribute.js';
import { horrorAudio } from './audio.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.state = 'MENU'; // MENU, PLAYING, JUMPSCARE, VICTORY

    this.scene = null;
    this.camera = null;
    this.renderer = null;

    this.map = null;
    this.player = null;
    this.enemy = null;
    this.items = null;
    this.altar = null;

    this.clock = new THREE.Clock();

    this.initThree();
    this.initWorld();
    this.bindUI();
    this.animate();
  }

  initThree() {
    // 1. Scene
    this.scene = new THREE.Scene();

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.scene.add(this.camera);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    window.addEventListener('resize', () => this.onWindowResize());
  }

  initWorld() {
    // Steamboat environment & corridors
    this.map = new SteamboatMap(this.scene);

    // Player with strict W/S forward/back and A/D turn camera controls
    this.player = new Player(this.camera, this.map, this.canvas);

    // Mr. Geil Enemy
    this.enemy = new GeilEnemy(this.scene, this.map);

    // Sint Presents & Anime Dakimakura pillows
    this.items = new ItemManager(this.scene, this.map);

    // Sacred Sinterklaas Tribute Altar
    this.altar = new TributeAltar(this.scene, this.map);

    // Player Interaction Listener (E, Space, Click)
    this.player.onInteract(() => this.handlePlayerInteraction());
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  bindUI() {
    const startBtn = document.getElementById('btn-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => this.startGame());
    }

    const retryBtn = document.getElementById('btn-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.restartGame());
    }

    const playAgainBtn = document.getElementById('btn-play-again');
    if (playAgainBtn) {
      playAgainBtn.addEventListener('click', () => this.restartGame());
    }

    const muteBtn = document.getElementById('btn-mute');
    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        const isMuted = horrorAudio.toggleMute();
        muteBtn.innerText = isMuted ? '🔇 Audio: OFF' : '🔊 Audio: ON';
      });
    }
  }

  startGame() {
    horrorAudio.init();
    horrorAudio.resume();

    const titleScreen = document.getElementById('title-screen');
    if (titleScreen) titleScreen.style.display = 'none';

    const hud = document.getElementById('game-hud');
    if (hud) hud.style.display = 'block';

    this.state = 'PLAYING';
    this.clock.start();
    this.renderer.render(this.scene, this.camera);
  }

  handlePlayerInteraction() {
    if (this.state !== 'PLAYING') return;

    const playerPos = this.player.getPosition();

    // 1. Check if near an unwrapped Sint present
    const nearPresent = this.items.update(0, playerPos);
    if (nearPresent && !nearPresent.isUnwrapped) {
      this.items.unwrapPresent(nearPresent);
      return;
    }

    // 2. Check if near the Tribute Altar
    const nearAltar = this.altar.update(0, playerPos);
    if (nearAltar) {
      if (this.items.isReadyForTribute()) {
        this.altar.performTribute(this.items, this.enemy, () => this.triggerVictory());
      }
    }
  }

  update(delta) {
    if (this.state !== 'PLAYING') return;

    // Update Player movement & camera
    this.player.update(delta);
    const playerPos = this.player.getPosition();

    // Update Map animations (flickering lanterns)
    this.map.update(this.clock.getElapsedTime());

    // Update Presents & Body Pillows
    const nearPresent = this.items.update(delta, playerPos);

    // Update Tribute Altar
    const nearAltar = this.altar.update(delta, playerPos);

    // Update Interaction Hint on HUD
    this.updateInteractionPrompt(nearPresent, nearAltar);

    // Update Mr. Geil Monster AI
    this.enemy.update(delta, playerPos, () => this.triggerJumpscare());
  }

  updateInteractionPrompt(nearPresent, nearAltar) {
    const prompt = document.getElementById('interaction-prompt');
    if (!prompt) return;

    if (nearPresent && !nearPresent.isUnwrapped) {
      prompt.style.display = 'block';
      prompt.innerHTML = `<span class="key-tag">[E]</span> or <span class="key-tag">[Click]</span> Unwrap Sint Present`;
    } else if (nearAltar && !this.altar.isOffered) {
      prompt.style.display = 'block';
      if (this.items.isReadyForTribute()) {
        prompt.innerHTML = `<span class="key-tag pulse">[E]</span> OFFER 5 ANIME BODY PILLOWS ON ALTAR!`;
      } else {
        prompt.innerHTML = `Tribute Altar: Needs ${this.items.requiredCount} Anime Body Pillows (Current: ${this.items.collectedCount}/${this.items.requiredCount})`;
      }
    } else {
      prompt.style.display = 'none';
    }
  }

  triggerJumpscare() {
    if (this.state !== 'PLAYING') return;
    this.state = 'JUMPSCARE';

    // Play terrifying scream stinger
    horrorAudio.playJumpscare();

    // Show Jumpscare overlay
    const jumpscareModal = document.getElementById('jumpscare-screen');
    if (jumpscareModal) jumpscareModal.style.display = 'flex';

    const hud = document.getElementById('game-hud');
    if (hud) hud.style.display = 'none';
  }

  triggerVictory() {
    this.state = 'VICTORY';

    const victoryModal = document.getElementById('victory-screen');
    if (victoryModal) victoryModal.style.display = 'flex';

    const hud = document.getElementById('game-hud');
    if (hud) hud.style.display = 'none';
  }

  restartGame() {
    // Reset positions
    this.player.setPosition(this.map.playerStart.x, this.map.playerStart.z);
    this.enemy.resetPosition();

    // Recreate presents and altar
    this.scene.remove(this.altar.group);
    this.items.presents.forEach(p => this.scene.remove(p.group));

    this.items = new ItemManager(this.scene, this.map);
    this.altar = new TributeAltar(this.scene, this.map);
    this.items.updateHUD();

    // Hide modals
    const jumpscareModal = document.getElementById('jumpscare-screen');
    if (jumpscareModal) jumpscareModal.style.display = 'none';

    const victoryModal = document.getElementById('victory-screen');
    if (victoryModal) victoryModal.style.display = 'none';

    const hud = document.getElementById('game-hud');
    if (hud) hud.style.display = 'block';

    const banner = document.getElementById('objective-banner');
    if (banner) {
      banner.innerHTML = "Collect 5 Anime Body Pillows from Sint Presents and bring them to the Tribute Altar!";
      banner.classList.remove('pulse-gold');
    }

    this.state = 'PLAYING';
    horrorAudio.resume();
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.update(delta);

    this.renderer.render(this.scene, this.camera);
  }
}

// Start game on window load
window.addEventListener('DOMContentLoaded', () => {
  new Game();
});
