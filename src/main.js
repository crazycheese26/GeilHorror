// Game loop, state machine, settings, and every DOM read/write. The simulation
// modules stay free of UI so they can be driven headlessly.

import { SteamboatMap } from './map.js';
import { Player } from './player.js';
import { GeilEnemy, STATE } from './enemy.js';
import { ItemManager } from './items.js';
import { TributeAltar } from './tribute.js';
import { Lantern } from './lantern.js';
import { TextureFactory } from './textures.js';
import { horrorAudio } from './audio.js';
import { Rng, makeSeed, formatSeed, parseSeed } from './rng.js';
import { generateRunLayout } from './layout.js';
import { Room, MAX_PLAYERS } from './net/room.js';
import { NetSession, MODE, BLEED_SECONDS } from './net/session.js';
import { CrewView } from './crew.js';
import { makeRoomCode, normaliseCode, isValidCode } from './net/signal.js';

const SETTINGS_KEY = 'geil.settings.v1';

// Sinterklaas, on deck, explaining the job. He is the reason there is an altar
// in het ruim at all: the offering is his idea, not yours.
const SINT_LINES = [
  'Kind, listen. We are halfway to the wal and something came aboard with the pakjes. It lives in het ruim now. Mijnheer Geil.',
  'I cannot go down there. The Pieten will not go down there. But the boat cannot dock with him awake in the hold, and by morning we have to be ashore.',
  'He cannot be fought and he cannot be reasoned with. He can only be given something. Five of the pakjes below deck have an anime body pillow in them. Find five. Tear them open.',
  'Carry them to the altar in het ruim and lay them out in a row, and he will want nothing else for the rest of the crossing. Do that and the hold goes quiet.',
  'Take this before you go down. A lantaarntje — the Pieten carried them in the hold, and the flame in this one does not care for Mijnheer Geil. It ticks when he is near you, and faster the nearer he comes. It will not tell you where he is. Only how much room you have left.',
  'Hold your breath at every corner. Keep the torch off unless you must. And whatever you do — do not let him see you tearing the paper.'
];

// Typewriter speed, characters per second.
const INTRO_CPS = 46;

// How long the offering is left on screen before the ending is.
const VICTORY_DELAY = 1.4;

// What each mode is, in one line, on the lobby screen.
const MODE_NOTES = {
  coop: 'Mr. Geil hunts all of you at once. Caught is not dead — you go down ' +
        'on the deck and somebody has to come and haul you back up before you ' +
        'bleed out.',
  hunt: 'One of you is Mr. Geil, in the first person, with no torch and no ' +
        'lantaarntje — only a nose for whoever is making noise. The rest still ' +
        'have five pillows to find.'
};

const DEFAULT_NAMES = [
  'Piet', 'Roetveeg', 'Pepernoot', 'Wegwijs', 'Schoorsteen', 'Marsepein',
  'Stoomboot', 'Kruidnoot', 'Lantaarn', 'Zwarte Piet'
];

const DEFAULT_SETTINGS = {
  controlScheme: 'mouse',
  brightness: 40,
  sensitivity: 1.0,
  volume: 75,
  // Empty means a new ship every run. Anything typed here pins the layout.
  seed: '',
  // What the rest of the crew sees over your head.
  playerName: ''
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
    this.victoryTimer = 0;

    this.runSeed = 0;
    this.runLayout = null;
    this.runRng = null;

    // Multiplayer. All three stay null for a run played alone, and every
    // branch that reads them is written so that null is the game as it was.
    this.room = null;
    this.session = null;
    this.crew = null;
    this.netOutcome = null;
    // The boat does not stop because one person opened the menu, so a paused
    // crew run keeps simulating with the controller switched off.
    this.netPaused = false;
    this.joinOnBoot = null;

    this.introIndex = 0;
    this.introTyped = 0;
    this.introDone = false;
    // Music mood only falls back to the exploration bed after this many
    // quiet seconds, so a near miss does not flap the score.
    this.calmTimer = 0;

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

    // Every slider for a setting, on whichever screen, shows the same value.
    // The pause menu's copies used to be hardcoded to the defaults, so opening
    // it after changing anything showed the wrong position, and nudging one
    // snapped the setting back to it.
    for (const el of this.dom.settingInputs) {
      const value = String(this.settingValue(el.dataset.setting));
      if (el.value !== value) el.value = value;
    }
    // Only write a seed box back when it disagrees, so typing in one does not
    // fight the caret. There are two of them — the title screen's and the
    // lobby's — and they are the same setting.
    for (const el of this.dom.seedInputs) {
      if (el.value !== this.settings.seed) el.value = this.settings.seed;
    }
    if (this.dom.name && this.dom.name.value !== this.settings.playerName) {
      this.dom.name.value = this.settings.playerName;
    }

    this.saveSettings();
  }

  // The slider position for a setting, in the units the input is marked up in.
  settingValue(name) {
    if (name === 'sensitivity') return Math.round(this.settings.sensitivity * 100);
    return this.settings[name];
  }

  cacheDom() {
    const $ = id => document.getElementById(id);
    this.dom = {
      hud: $('hud'),
      title: $('title-screen'),
      intro: $('intro-screen'),
      introLine: $('intro-line'),
      introPips: $('intro-pips'),
      introNext: $('btn-intro-next'),
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
      lantern: $('lantern'),
      objective: $('objective'),
      settingInputs: document.querySelectorAll('[data-setting]'),
      seedInputs: document.querySelectorAll('[data-seed-input]'),
      seedLabels: document.querySelectorAll('[data-run-seed]'),
      deathReason: $('death-reason'),

      // Crew
      lobby: $('lobby-screen'),
      name: $('set-name'),
      joinCode: $('join-code'),
      lobbyOpen: $('lobby-open'),
      lobbyRoom: $('lobby-room'),
      lobbyMode: $('lobby-mode'),
      lobbyCrew: $('lobby-crew'),
      lobbySeed: $('lobby-seed'),
      modeNote: $('mode-note'),
      crewList: $('crew-list'),
      lobbyStatus: $('lobby-status'),
      launch: $('btn-launch'),
      roomCodes: document.querySelectorAll('[data-room-code]'),
      crewPanel: $('crew-panel'),
      huntPanel: $('hunt-panel'),
      reukFill: $('reuk-fill'),
      reukName: $('reuk-name'),
      preyLeft: $('prey-left'),
      downed: $('downed'),
      bleedFill: $('bleed-fill'),
      crewEnd: $('crew-end-screen'),
      crewAgain: $('btn-crew-again'),
      crewEndTitle: $('crew-end-title'),
      crewEndText: $('crew-end-text'),
      crewEndDetail: $('crew-end-detail'),
      crewEndList: $('crew-end-list')
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
    this.planRun();

    this.player = new Player(this.camera, this.map, this.canvas, this.settings);
    this.enemy = new GeilEnemy(this.scene, this.map);
    this.enemy.applyRunLayout(this.runLayout);
    this.enemy.reset();
    this.items = new ItemManager(this.scene, this.map, this.runRng);
    this.altar = new TributeAltar(this.scene, this.map);
    this.lantern = new Lantern();

    this.attachItemHooks();

    this.player.onLockChange = (locked) => {
      if (!locked && this.state === 'PLAYING' && this.settings.controlScheme === 'mouse') {
        this.pause();
      }
    };
  }

  attachItemHooks() {
    this.items.onUnwrapped = (pillow, x, z, radius, openerId) => {
      const opener = this.session && openerId ? this.session.players.get(openerId) : null;
      const by = opener && opener.id !== this.session.localId ? opener.name : null;
      this.showToast(pillow.name, pillow.quote, by);
      // Only the browser thinking for him gets to tell him about the bang.
      if (!this.session || this.session.isHost) this.enemy.hearNoiseAt(x, z, radius / 30);
      this.enemy.setTier(this.items.collectedCount);
      this.updateObjective();
      this.renderPips();
    };
  }

  // --- The run's ship --------------------------------------------------

  // Roll (or re-roll) where the pakjes lie, where Mr. Geil starts, the circuit
  // he paces and which lanterns are dead.
  //
  //   auto  - use the seed typed on the title screen, or roll one
  //   keep  - sail the same ship again
  //   fresh - deal a different ship, even if one was pinned
  //   net   - sail the host's ship, whose seed is handed in
  planRun(mode = 'auto', seed = null) {
    if (mode === 'net') {
      this.runSeed = seed >>> 0;
      this.runRng = new Rng(this.runSeed);
      this.runLayout = generateRunLayout(this.map, this.runRng);
      this.map.applyRunLayout(this.runLayout);
      this.showSeed();
      return;
    }
    if (mode === 'fresh' && this.settings.seed) {
      // Asking for a new ship while holding a pinned one means letting go of it.
      this.settings.seed = '';
      this.applySettings();
    }

    const pinned = parseSeed(this.settings.seed);
    if (pinned !== null) this.runSeed = pinned;
    else if (mode !== 'keep' || !this.runSeed) this.runSeed = makeSeed();

    this.runRng = new Rng(this.runSeed);
    this.runLayout = generateRunLayout(this.map, this.runRng);
    this.map.applyRunLayout(this.runLayout);
    this.showSeed();
  }

  showSeed() {
    const code = formatSeed(this.runSeed);
    for (const el of this.dom.seedLabels) el.textContent = code;
  }

  bindUI() {
    const on = (id, ev, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };

    // Starting from the title plans the run there and then, so a seed typed
    // into the box takes effect on the ship you are about to walk into.
    // Sint speaks first; the retry buttons skip him, because nobody wants the
    // briefing again on their ninth attempt.
    on('btn-start', 'click', () => this.beginIntro('auto'));
    on('btn-crew', 'click', () => this.openLobby());
    on('btn-host', 'click', () => this.hostGame());
    on('btn-join', 'click', () => this.joinGame());
    on('btn-copy', 'click', () => this.copyInvite());
    on('btn-launch', 'click', () => this.launchCrewRun());
    on('btn-lobby-back', 'click', () => this.leaveLobby());
    on('btn-crew-again', 'click', () => this.crewBackToLobby());
    on('btn-crew-leave', 'click', () => this.toMenu());
    on('btn-intro-next', 'click', () => this.advanceIntro());
    on('btn-intro-skip', 'click', () => this.startGame());
    on('btn-resume', 'click', () => this.resume());
    on('btn-quit', 'click', () => this.toMenu());
    on('btn-retry', 'click', () => this.restart('keep'));
    on('btn-retry-new', 'click', () => this.restart('fresh'));
    on('btn-play-again', 'click', () => this.restart('fresh'));
    on('btn-again-seed', 'click', () => this.restart('keep'));

    for (const el of document.querySelectorAll('[data-scheme]')) {
      el.addEventListener('click', () => {
        this.settings.controlScheme = el.dataset.scheme;
        this.player.releaseAllKeys();
        this.applySettings();
      });
    }

    for (const el of this.dom.settingInputs) {
      el.addEventListener('input', (e) => {
        const value = Number(e.target.value);
        const name = el.dataset.setting;
        if (name === 'sensitivity') this.settings.sensitivity = value / 100;
        else this.settings[name] = value;
        this.applySettings();
      });
    }
    for (const el of this.dom.seedInputs) {
      el.addEventListener('input', (e) => {
        this.settings.seed = e.target.value;
        this.saveSettings();
        this.applySettings();
      });
    }
    if (this.dom.name) {
      this.dom.name.addEventListener('input', (e) => {
        this.settings.playerName = e.target.value.slice(0, 14);
        this.saveSettings();
      });
    }
    if (this.dom.joinCode) {
      // The code is five characters from an alphabet with no O and no I, so
      // there is nothing to get wrong by typing it in lower case.
      this.dom.joinCode.addEventListener('input', (e) => {
        e.target.value = normaliseCode(e.target.value);
      });
      this.dom.joinCode.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.joinGame();
      });
    }
    for (const el of document.querySelectorAll('[data-mode]')) {
      el.addEventListener('click', () => {
        if (this.session && this.session.isHost) this.session.setMode(el.dataset.mode);
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.netPaused) this.resume();
        else if (this.state === 'PLAYING') this.pause();
        else if (this.state === 'PAUSED') this.resume();
        else if (this.state === 'INTRO') this.toMenu();
        else if (this.state === 'LOBBY') this.leaveLobby();
        return;
      }
      if (this.state === 'INTRO' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.advanceIntro();
      }
    });

    // Browsers will not let audio start before the player touches something,
    // so the title theme waits for the first gesture anywhere on the page.
    const prime = () => {
      horrorAudio.init();
      horrorAudio.resume();
      this.updateMusic();
    };
    window.addEventListener('pointerdown', prime, { once: true });
    window.addEventListener('keydown', prime, { once: true });
  }

  // --- Sint's briefing --------------------------------------------------

  beginIntro(mode = 'auto') {
    horrorAudio.init();
    horrorAudio.resume();
    // Sint's briefing is the way into a run played alone; leaving a room open
    // behind it would strand whoever was waiting in it.
    this.closeRoom();

    // Deal the ship now, so a seed typed into the box is the boat he is
    // describing.
    this.resetRun(mode);

    this.state = 'INTRO';
    this.introIndex = 0;
    this.introTyped = 0;
    this.introDone = false;

    this.player.setEnabled(false);
    this.show(this.dom.title, false);
    this.show(this.dom.hud, false);
    this.show(this.dom.intro, true);
    this.renderIntroPips();
    this.updateMusic();
  }

  // First press finishes the line being typed; the next one moves on.
  advanceIntro() {
    if (this.state !== 'INTRO') return;

    if (!this.introDone) {
      this.introTyped = SINT_LINES[this.introIndex].length;
      this.introDone = true;
      this.paintIntroLine();
      return;
    }
    if (this.introIndex >= SINT_LINES.length - 1) {
      this.startGame();
      return;
    }
    this.introIndex++;
    this.introTyped = 0;
    this.introDone = false;
    this.paintIntroLine();
    this.renderIntroPips();
    horrorAudio.playClick();
  }

  updateIntro(delta) {
    if (this.introDone) return;
    const line = SINT_LINES[this.introIndex];
    const before = Math.floor(this.introTyped);
    this.introTyped = Math.min(line.length, this.introTyped + delta * INTRO_CPS);
    if (this.introTyped >= line.length) this.introDone = true;
    // Only touch the DOM on a frame that actually reveals a character.
    if (this.introDone || Math.floor(this.introTyped) !== before) this.paintIntroLine();
  }

  paintIntroLine() {
    const line = SINT_LINES[this.introIndex];
    if (this.dom.introLine) {
      this.dom.introLine.textContent = line.slice(0, Math.floor(this.introTyped));
      this.dom.introLine.classList.toggle('is-typing', !this.introDone);
    }
    if (this.dom.introNext) {
      this.dom.introNext.textContent =
        this.introDone && this.introIndex >= SINT_LINES.length - 1 ? 'Ga naar beneden' : 'Verder';
    }
  }

  renderIntroPips() {
    if (!this.dom.introPips) return;
    this.dom.introPips.innerHTML = '';
    for (let i = 0; i < SINT_LINES.length; i++) {
      const pip = document.createElement('span');
      pip.className = 'pip' + (i <= this.introIndex ? ' is-filled' : '');
      this.dom.introPips.appendChild(pip);
    }
  }

  // --- Score ------------------------------------------------------------

  // One place decides what should be playing, so every transition agrees.
  updateMusic() {
    switch (this.state) {
      case 'MENU':
      case 'INTRO':
      case 'LOBBY':
        horrorAudio.stopCues();
        horrorAudio.setBed('title', 1.0);
        break;
      case 'PLAYING':
      case 'PAUSED':
        horrorAudio.stopCues();
        if (!horrorAudio.currentBed || horrorAudio.currentBed === 'title') {
          horrorAudio.setBed('explore', 1.6);
          this.calmTimer = 0;
        }
        break;
      default:
        break;
    }
  }

  // Explore and stalk trade places on how much he actually knows, with a hold
  // on the way back down so one glance does not flip the score twice.
  updateMusicMood(delta) {
    const e = this.enemy;
    if (e.state === STATE.PACIFIED) {
      horrorAudio.setBed('explore');
      return;
    }
    // Whoever is playing him is the reason the bed exists; it never lifts.
    if (this.session && this.session.isHunter()) {
      horrorAudio.setBed('stalk');
      return;
    }

    const hunting = e.state === STATE.CHASE || e.state === STATE.SEARCH ||
                    e.state === STATE.SUSPICIOUS;
    const closing = e.distToViewer < 11;

    if (hunting || e.awareness > 0.3 || closing) {
      this.calmTimer = 4.5;
      horrorAudio.setBed('stalk');
    } else if (this.calmTimer > 0) {
      this.calmTimer -= delta;
    } else {
      horrorAudio.setBed('explore');
    }
  }

  // --- State transitions -----------------------------------------------

  show(el, visible) {
    if (el) el.classList.toggle('is-visible', visible);
  }

  startGame() {
    horrorAudio.init();
    horrorAudio.resume();

    this.show(this.dom.title, false);
    this.show(this.dom.intro, false);
    this.show(this.dom.pause, false);
    this.show(this.dom.death, false);
    this.show(this.dom.victory, false);
    this.show(this.dom.crewEnd, false);
    this.show(this.dom.hud, true);

    this.state = 'PLAYING';
    this.netPaused = false;
    this.calmTimer = 0;
    this.updateMusic();
    this.player.setEnabled(true);
    if (this.settings.controlScheme === 'mouse') this.player.requestPointerLock();

    this.currentZone = null;
    this.updateObjective();
    this.renderPips();
    this.clock.getDelta();
  }

  pause() {
    if (this.state !== 'PLAYING') return;

    // The boat does not stop because one person opened the menu. The run keeps
    // simulating with the controller switched off, so a crewmate who tabs away
    // is a crewmate standing still — not four people frozen mid-corridor.
    if (this.netRun()) {
      this.netPaused = true;
      this.player.setEnabled(false);
      this.player.exitPointerLock();
      this.show(this.dom.pause, true);
      return;
    }

    this.state = 'PAUSED';
    this.player.setEnabled(false);
    this.player.exitPointerLock();
    horrorAudio.setThreat(0);
    // The bed keeps playing while paused; only the synthesised tension stops.
    this.show(this.dom.pause, true);
  }

  resume() {
    if (this.netPaused) {
      this.netPaused = false;
      this.show(this.dom.pause, false);
      this.player.setEnabled(true);
      if (this.settings.controlScheme === 'mouse') this.player.requestPointerLock();
      return;
    }
    if (this.state !== 'PAUSED') return;
    this.show(this.dom.pause, false);
    this.state = 'PLAYING';
    this.player.setEnabled(true);
    if (this.settings.controlScheme === 'mouse') this.player.requestPointerLock();
    this.clock.getDelta();
  }

  toMenu() {
    this.closeRoom();
    // Hold the ship as it was; pressing start plans the next one.
    this.resetRun('keep');
    this.state = 'MENU';
    this.player.setEnabled(false);
    this.player.exitPointerLock();
    this.show(this.dom.pause, false);
    this.show(this.dom.intro, false);
    this.show(this.dom.lobby, false);
    this.show(this.dom.crewEnd, false);
    this.show(this.dom.hud, false);
    this.show(this.dom.title, true);
    this.updateMusic();
  }

  // 'keep' replays the layout you just lost on, which is the difference between
  // learning a ship and rolling the dice again.
  restart(mode = 'auto') {
    this.resetRun(mode);
    this.startGame();
  }

  resetRun(mode = 'auto', seed = null) {
    this.planRun(mode, seed);

    this.items.dispose();
    this.items = new ItemManager(this.scene, this.map, this.runRng);
    this.attachItemHooks();

    this.altar.reset();
    this.player.reset();
    this.lantern.reset();
    this.paintLantern();
    this.enemy.applyRunLayout(this.runLayout);
    this.enemy.reset();

    horrorAudio.setThreat(0);
    horrorAudio.stopCues();
    this.show(this.dom.death, false);
    this.show(this.dom.victory, false);
    this.show(this.dom.danger, false);
    this.show(this.dom.hiddenMask, false);
    this.deathTimer = 0;
    this.victoryTimer = 0;
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
    // Let the scream have the room to itself before the theme comes in under
    // the death screen's own fade.
    horrorAudio.setBed(null, 0.5);
    setTimeout(() => {
      if (this.state === 'DEAD') horrorAudio.playGameOverTheme();
    }, 900);

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
    this.victoryTimer = 0;
    this.player.setEnabled(false);
    this.player.exitPointerLock();
    horrorAudio.setThreat(0);
    horrorAudio.playVictoryTheme();
    this.show(this.dom.hud, false);
    this.show(this.dom.victory, true);
  }

  // --- The crew --------------------------------------------------------
  //
  // Everything below is the screen half of multiplayer: the lobby, the roster,
  // the endings. The wire half is in src/net, and it never touches the DOM —
  // net/session.js drives this class through a handful of named callbacks
  // (beginNetRun, endNetRun, onCrew*, onReuk) and reads the world back out of
  // world(). Single player never constructs any of it and never reads a branch
  // that depends on it.

  // The handful of objects the session is allowed to reach into.
  world() {
    return {
      map: this.map,
      player: this.player,
      enemy: this.enemy,
      items: this.items,
      altar: this.altar,
      crew: this.crew
    };
  }

  // The session, but only while there is actually a run going on.
  netRun() {
    return this.session && this.session.phase === 'run' ? this.session : null;
  }

  reveal(el, visible) {
    if (el) el.classList.toggle('is-hidden', !visible);
  }

  displayName() {
    const typed = (this.settings.playerName || '').trim().slice(0, 14);
    if (typed) return typed;
    // Nobody should have to fill a form in to play with their friends.
    return DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)];
  }

  // --- Lobby ------------------------------------------------------------

  openLobby(prefill = null) {
    horrorAudio.init();
    horrorAudio.resume();

    this.state = 'LOBBY';
    this.player.setEnabled(false);
    this.player.exitPointerLock();
    this.show(this.dom.title, false);
    this.show(this.dom.intro, false);
    this.show(this.dom.hud, false);
    this.show(this.dom.crewEnd, false);
    this.show(this.dom.lobby, true);
    this.updateMusic();

    if (prefill && this.dom.joinCode) this.dom.joinCode.value = normaliseCode(prefill);
    this.setNetStatus('');
    this.renderLobby();
  }

  leaveLobby() {
    this.closeRoom();
    this.toMenu();
  }

  hostGame() {
    this.openRoom(makeRoomCode(), true);
  }

  joinGame() {
    const code = normaliseCode(this.dom.joinCode ? this.dom.joinCode.value : '');
    if (!isValidCode(code)) {
      this.setNetStatus('A code is five characters — no O and no I.', 'warn');
      return;
    }
    this.openRoom(code, false);
  }

  async openRoom(code, host) {
    this.closeRoom();

    const name = this.displayName();
    this.settings.playerName = name;
    this.applySettings();

    const room = new Room({ code, host, name });
    room.onstatus = (state, detail) => this.onRoomStatus(state, detail);
    this.room = room;
    this.session = new NetSession({ room, game: this, name });
    this.session.assignHunter();

    this.paintRoomCode(code);
    this.renderLobby();
    this.setNetStatus(host ? 'Opening a boat…' : 'Looking for that boat…');

    const opened = await room.open();
    if (!opened && this.room === room) {
      this.setNetStatus(
        'Could not reach the lobby service. Check the connection and try again.',
        'bad'
      );
    }
  }

  onRoomStatus(state, detail) {
    switch (state) {
      case 'hosting':
        this.setNetStatus(`Boat open. Read out ${detail}, or send the link.`);
        break;
      case 'joining':
        this.setNetStatus('Knocking on the hull…');
        break;
      case 'handshaking':
        this.setNetStatus('Found them. Opening a line…');
        break;
      case 'nohost':
        this.setNetStatus(
          'Nobody is holding that boat open. Check the code — and the host has ' +
          'to still have the tab in front of them.',
          'bad'
        );
        break;
      case 'full':
        this.setNetStatus(detail || 'That boat is full.', 'bad');
        break;
      case 'hostleft':
        this.setNetStatus('The boat closed.', 'bad');
        break;
      case 'error':
        if (detail) this.setNetStatus(detail, 'warn');
        break;
      default:
        break;
    }
  }

  closeRoom() {
    if (this.room) {
      this.room.close();
      this.room = null;
    }
    this.session = null;
    this.netOutcome = null;
    this.netPaused = false;
    if (this.crew) this.crew.clear();

    // Put every switch multiplayer threw back where single player expects it.
    delete document.body.dataset.net;
    delete document.body.dataset.role;
    this.player.setProfile('survivor');
    this.player.setFrozen(false);
    this.items.announceOnly = false;
    this.items.onWantUnwrap = null;
    this.enemy.setControl({ simulate: true, authoritative: true });
    this.enemy.setEmbodied(false);
    this.renderCrewHud();
  }

  inviteLink() {
    if (!this.room) return '';
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set('room', this.room.code);
    return url.toString();
  }

  copyInvite() {
    const link = this.inviteLink();
    if (!link) return;
    const done = () => this.setNetStatus('Link copied. Send it to whoever is coming.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, () => this.setNetStatus(link));
    } else {
      // No clipboard (an insecure origin, usually). Showing it is still useful.
      this.setNetStatus(link);
    }
  }

  paintRoomCode(code) {
    for (const el of this.dom.roomCodes) el.textContent = code || '-----';
  }

  setNetStatus(text, tone = '') {
    const el = this.dom.lobbyStatus;
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-warn', tone === 'warn');
    el.classList.toggle('is-bad', tone === 'bad');
  }

  renderLobby() {
    const session = this.session;
    const inRoom = !!(session && this.room);
    const host = inRoom && session.isHost;

    this.reveal(this.dom.lobbyOpen, !inRoom);
    this.reveal(this.dom.lobbyRoom, inRoom);
    this.reveal(this.dom.lobbyMode, inRoom);
    this.reveal(this.dom.lobbyCrew, inRoom);
    this.reveal(this.dom.lobbySeed, host);

    if (!inRoom) {
      this.reveal(this.dom.launch, false);
      return;
    }

    for (const el of document.querySelectorAll('[data-mode]')) {
      el.classList.toggle('is-active', el.dataset.mode === session.mode);
      el.disabled = !host;
    }
    if (this.dom.modeNote) this.dom.modeNote.textContent = MODE_NOTES[session.mode] || '';

    this.paintCrewList(this.dom.crewList, session, host);

    // The hunt needs somebody to hunt.
    const enough = session.mode !== MODE.HUNT || session.playerCount() >= 2;
    this.reveal(this.dom.launch, host);
    if (this.dom.launch) {
      this.dom.launch.disabled = !enough;
      this.dom.launch.textContent = enough ? 'Go below' : 'Waiting for a crew';
    }
    const me = session.local();
    // Never over the top of something that went wrong.
    if (!host && me && this.dom.lobbyStatus &&
        !this.dom.lobbyStatus.classList.contains('is-bad')) {
      this.setNetStatus(`Aboard as ${me.name}. Waiting for the host to cast off.`);
    }
  }

  paintCrewList(list, session, host) {
    if (!list) return;
    list.innerHTML = '';

    for (const player of session.crew()) {
      const row = document.createElement('li');
      row.style.color = player.css;
      row.classList.toggle('is-you', player.id === session.localId);
      row.classList.toggle('is-gone', !player.present || player.dead);

      const tag = document.createElement('span');
      tag.className = 'tag';

      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = player.name + (player.id === session.localId ? ' (you)' : '');

      const role = document.createElement('span');
      role.className = 'role';
      if (session.isHunter(player.id)) {
        role.classList.add('is-geil');
        role.textContent = 'Mr. Geil';
      } else if (player.dead) {
        role.textContent = 'taken';
      } else if (player.down) {
        role.textContent = 'down';
      } else if (player.id === session.room.hostId) {
        role.textContent = 'host';
      }

      row.append(tag, who, role);

      // The host can hand the mask to anybody in the room.
      if (host && session.mode === MODE.HUNT && !session.isHunter(player.id) &&
          session.phase === 'lobby') {
        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'pick';
        pick.textContent = 'play him';
        pick.addEventListener('click', () => session.setHunter(player.id));
        row.appendChild(pick);
      }

      list.appendChild(row);
    }
  }

  launchCrewRun() {
    if (!this.session || !this.session.isHost) return;
    const pinned = parseSeed(this.settings.seed);
    this.session.startRun(pinned === null ? makeSeed() : pinned);
  }

  // --- Session callbacks -------------------------------------------------

  onCrewChanged() {
    if (this.state === 'LOBBY') this.renderLobby();
    this.renderCrewHud();
  }

  // One crewmate's position, on its way to being drawn. The person playing
  // Mr. Geil is not drawn as a crewmate — he is drawn as Mr. Geil, from the
  // enemy's own transform — so his frames stop here.
  onCrewFrame(player) {
    if (!this.crew || !this.session) return;
    if (this.session.isHunter(player.id)) return;
    this.crew.push(player.id, {
      x: player.x, z: player.z, yaw: player.yaw, gait: player.gait,
      torch: player.torch, sneak: player.sneak, hidden: player.hidden,
      down: player.down, dead: player.dead
    }, performance.now() / 1000);
  }

  onCrewEvent(kind, player) {
    const session = this.session;
    const mine = session && player.id === session.localId;

    if (kind === 'down') {
      horrorAudio.playCrewDown();
      this.showToast(mine ? 'He has you' : `${player.name} is down`,
        mine ? 'Hold on. Somebody has to come and get you.'
             : 'Get to them before they bleed out.');
    } else if (kind === 'up') {
      horrorAudio.playCrewUp();
      this.showToast(mine ? 'On your feet' : `${player.name} is up`,
        'Move. He knows where that was.');
    } else if (kind === 'gone') {
      this.showToast(mine ? 'He took you' : `${player.name} is gone`,
        mine ? 'Watch the rest of it from where you fell.' : 'One fewer pair of hands.');
      if (mine) horrorAudio.playJumpscare();
    }
    this.renderCrewHud();
  }

  onReuk(reuk) {
    horrorAudio.playReuk(reuk.strength);
  }

  // --- Running with a crew ----------------------------------------------

  beginNetRun(session) {
    const me = session.local();
    const hunter = session.isHunter();

    // The seed is the ship. Everybody deals the same one from it, so none of
    // the layout has to travel.
    this.resetRun('net', session.seed);

    this.player.setProfile(hunter ? 'geil' : 'survivor');
    this.player.reset(this.berthFor(session, me));

    this.enemy.viewer = this.player;
    this.enemy.setControl({
      simulate: session.isHost && session.mode === MODE.COOP,
      authoritative: session.isHost
    });
    this.enemy.setEmbodied(hunter);
    if (session.mode === MODE.HUNT) {
      // Park him on the hunter's berth, so nobody watches him slide across the
      // ship on the first snapshot.
      const berth = this.runLayout.enemySpawn;
      this.enemy.applyRemote({ x: berth.x, z: berth.z });
    }

    // The host rules on who tore which pakje open, so finishing the hold asks
    // rather than opens. See items.js.
    this.items.announceOnly = true;
    this.items.onWantUnwrap = (present) => session.requestTear(present.id);

    // Built once, here, in the lobby — never mid-run. Every crewmate's torch
    // is a real light, and adding one to a live scene recompiles every
    // material in it.
    if (!this.crew) this.crew = new CrewView(this.scene, MAX_PLAYERS - 1);
    this.crew.clear();
    this.crew.setRoster(session.others().filter(p => !session.isHunter(p.id)));

    document.body.dataset.net = 'crew';
    document.body.dataset.role = hunter ? 'hunter' : 'survivor';
    this.netOutcome = null;
    this.netPaused = false;
    this.paintRoomCode(this.room ? this.room.code : '');

    this.show(this.dom.lobby, false);
    this.startGame();
    this.renderCrewHud();
  }

  // Where one player wakes up on this run. Read off the layout, which every
  // browser dealt for itself, so the session can seat the whole roster without
  // a byte of it going over the wire.
  berthFor(session, me) {
    if (!me || !this.runLayout) return this.map.playerStart;
    if (session.isHunter(me.id)) {
      const spawn = this.runLayout.enemySpawn;
      return { x: spawn.x, z: spawn.z };
    }
    const berths = (this.runLayout.crewSpawns && this.runLayout.crewSpawns.length)
      ? this.runLayout.crewSpawns
      : [this.map.playerStart];
    return berths[(me.berth || 0) % berths.length];
  }

  endNetRun(outcome, detail) {
    this.netOutcome = { outcome, detail };
    this.netPaused = false;
    this.show(this.dom.pause, false);

    // A room that falls apart while everybody is still in the lobby is not an
    // ending; it is a message and a door back to the code box.
    if (this.state !== 'PLAYING') {
      const copy = this.crewEndCopy(outcome, false);
      this.closeRoom();
      this.renderLobby();
      this.setNetStatus(copy.text, 'bad');
      return;
    }

    if (outcome === 'offered' && this.state === 'PLAYING') {
      // The same beat as a run played alone: watch him take it, then the screen.
      if (!this.altar.isOffered) this.altar.complete(this.enemy);
      this.victoryTimer = VICTORY_DELAY;
      return;
    }
    this.showCrewEnd(outcome, detail);
  }

  showCrewEnd(outcome, detail) {
    const session = this.session;
    const hunter = !!(session && session.isHunter());
    const won = outcome === 'offered' ? !hunter
      : outcome === 'taken' ? hunter
        : null;

    this.state = 'CREWEND';
    this.victoryTimer = 0;
    this.player.setEnabled(false);
    this.player.setFrozen(false);
    this.player.exitPointerLock();

    horrorAudio.setThreat(0);
    horrorAudio.stopCues();
    if (won === true) {
      horrorAudio.playVictoryTheme();
    } else if (won === false) {
      horrorAudio.setBed(null, 0.6);
      horrorAudio.playGameOverTheme();
    } else {
      horrorAudio.setBed('title', 1.2);
    }

    const copy = this.crewEndCopy(outcome, hunter);
    if (this.dom.crewEndTitle) this.dom.crewEndTitle.textContent = copy.title;
    if (this.dom.crewEndText) this.dom.crewEndText.textContent = copy.text;
    if (this.dom.crewEndDetail) this.dom.crewEndDetail.textContent = detail || '';
    if (session) this.paintCrewList(this.dom.crewEndList, session, false);

    if (this.dom.crewEnd) {
      this.dom.crewEnd.classList.toggle('is-won', won === true);
      this.dom.crewEnd.classList.toggle('is-lost', won === false);
    }
    // There is only a lobby to go back to if the boat is still afloat: a run
    // that ended because the host closed their tab has nowhere to return to.
    const afloat = !!(this.room && !this.room.closed &&
      (this.room.isHost || this.room.hostId));
    this.reveal(this.dom.crewAgain, afloat);
    this.show(this.dom.hud, false);
    this.show(this.dom.crewEnd, true);
  }

  crewEndCopy(outcome, hunter) {
    switch (outcome) {
      case 'offered':
        return hunter ? {
          title: 'HIJ KREEG ZIJN KUSSENS',
          text: 'They got five of them onto the altar in het ruim while you were ' +
                'somewhere else on the ship, and everything you wanted went out ' +
                'of you at once. The hold is quiet. You are, for the rest of the ' +
                'crossing, satisfied.'
        } : {
          title: 'HET OFFER IS GEBRACHT',
          text: 'Five pakjes torn open in the dark and five soft pillows laid out ' +
                'in a row on the warm altar. Nobody is hunting anybody any more, ' +
                'and the stoomboot comes safely ashore with all of you still on it.'
        };
      case 'taken':
        return hunter ? {
          title: 'DE BOOT IS VAN JOU',
          text: 'Every one of them is on the deck and the altar is still cold. ' +
                'Sinterklaas waits topside for people who are not coming back up, ' +
                'and below deck you have the run of the ship.'
        } : {
          title: 'HIJ HEEFT JULLIE ALLEMAAL',
          text: 'The altar stays cold. The stoomboot sails on without a single one ' +
                'of you, and he is — at last — extra geil.'
        };
      case 'hostgone':
        return {
          title: 'DE BOOT IS WEG',
          text: 'Whoever opened this boat closed their tab, and it went down with ' +
                'them. Open a new one and start again.'
        };
      default:
        return {
          title: 'DE OVERTOCHT IS AFGEBROKEN',
          text: 'The crossing ended before it finished.'
        };
    }
  }

  crewBackToLobby() {
    if (!this.session || !this.room || this.room.closed) {
      this.leaveLobby();
      return;
    }
    this.session.backToLobby();
    delete document.body.dataset.net;
    delete document.body.dataset.role;
    this.player.setProfile('survivor');
    this.player.setFrozen(false);
    this.enemy.setEmbodied(false);
    if (this.crew) this.crew.clear();
    this.show(this.dom.crewEnd, false);
    this.openLobby();
  }

  // --- Crew HUD ----------------------------------------------------------

  // Rebuilt rather than diffed: four rows a few times a second is nothing, and
  // there is no state to get out of step.
  renderCrewHud() {
    const panel = this.dom.crewPanel;
    if (!panel) return;
    panel.innerHTML = '';

    const session = this.netRun();
    if (!session) return;

    for (const player of session.crew()) {
      if (player.id === session.localId) continue;

      const row = document.createElement('div');
      row.className = 'crew-row';
      row.style.color = player.css;
      const geil = session.isHunter(player.id);
      row.classList.toggle('is-geil', geil);
      row.classList.toggle('is-down', player.down && !player.dead);
      row.classList.toggle('is-gone', player.dead || !player.present);

      const tag = document.createElement('span');
      tag.className = 'tag';
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = player.name;
      const how = document.createElement('span');
      how.className = 'how';
      how.textContent = !player.present ? 'gone'
        : geil ? 'hunting'
          : player.dead ? 'taken'
            : player.down ? `down ${Math.max(0, Math.ceil(player.bleed))}s`
              : player.hidden ? 'hidden' : '';

      row.append(tag, who, how);
      panel.appendChild(row);
    }
  }

  paintReuk(session) {
    const d = this.dom;
    const reuk = session.reuk;

    if (d.reukFill) d.reukFill.style.width = `${Math.round(reuk.strength * 100)}%`;
    if (d.reukName) {
      d.reukName.textContent = reuk.strength > 0.02 ? (reuk.name || '') : '— stil —';
    }
    if (d.preyLeft) {
      const left = session.upright().length;
      d.preyLeft.textContent = `${left} still standing`;
    }
    if (d.threatRing) {
      const show = reuk.strength > 0.02;
      d.threatRing.classList.toggle('is-visible', show);
      if (show) {
        const angle = this.screenBearing(reuk.dx, reuk.dz);
        d.threatRing.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
        d.threatRing.style.opacity = String(Math.min(1, 0.3 + reuk.strength * 0.7));
      }
    }
  }

  // A world-space direction, as an angle around the crosshair.
  screenBearing(dx, dz) {
    const yaw = this.player.yaw;
    const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    return Math.atan2(dx * right.x + dz * right.z, dx * fwd.x + dz * fwd.z);
  }

  // --- Simulation ------------------------------------------------------

  update(delta) {
    if (this.state !== 'PLAYING') return;

    const net = this.netRun();
    const me = net ? net.local() : null;
    // On the deck the head still turns; the body does not.
    const downed = !!(me && (me.down || me.dead));
    this.player.setFrozen(downed);

    this.player.update(delta);
    const pos = this.player.getPosition();

    this.map.update(delta, this.clock.elapsedTime, pos);

    const interactPressed = this.player.consumeInteract();
    const interactHeld = this.player.interactHeld && !downed;

    const altarState = this.altar.update(delta, pos, interactHeld, this.items, {
      remoteOffering: net ? net.remoteOffering() : false,
      // Only the host rules on the offering; the rest are shown where it is up
      // to, so two browsers cannot both decide the run is over.
      driven: !!net && !net.isHost
    });

    // Holding E over a crewmate on the deck is hauling them up, not quietly
    // tearing the paper off a pakje that happens to be lying next to them.
    const canOpenPresents = !this.player.isHidden && !altarState.canOffer &&
      !downed && !(net && (net.isHunter() || net.reviveTarget));
    const itemState = this.items.update(delta, pos, interactHeld, canOpenPresents);

    if (!downed) this.handleHiding(interactPressed, pos, itemState, altarState);

    if (net) {
      if (net.isHost && !this.altar.isOffered && this.altar.progress >= 1 &&
          this.items.isReadyForTribute()) {
        this.altar.complete(this.enemy);
        net.onOffered();
      }
    } else if (altarState.canOffer && altarState.progress >= 1 && !this.altar.isOffered) {
      this.altar.complete(this.enemy);
      // A beat to watch him take the offering before the screen comes up. It
      // runs on the loop rather than a timer, because pausing in that gap has
      // to delay the ending, not cancel it: the altar is spent by then, so a
      // victory that never fires cannot be re-earned.
      this.victoryTimer = VICTORY_DELAY;
    }

    if (this.victoryTimer > 0) {
      this.victoryTimer -= delta;
      if (this.victoryTimer <= 0) {
        if (this.netOutcome) this.showCrewEnd(this.netOutcome.outcome, this.netOutcome.detail);
        else this.triggerVictory();
      }
    }

    // The session first, so a body driven by a person is in place before he is
    // asked what he can reach.
    if (net) net.update(delta);

    // Mr. Geil. The host thinks for him and rules on who he caught; every
    // other browser only draws and sounds him. See enemy.js: setControl.
    this.enemy.viewer = this.player;
    if (net) {
      const targets = net.isHost ? net.huntTargets(this.world()) : [this.player];
      this.enemy.update(delta, targets,
        net.isHost ? (target) => net.onCatch(target, this.world()) : null);
    } else {
      this.enemy.update(delta, this.player, () => this.triggerDeath());
    }

    if (net && this.crew) this.crew.update(delta, pos, { showNames: !net.isHunter() });

    this.updateMusicMood(delta);
    this.updateLantern(delta);

    this.updateHud(pos, itemState, altarState, net);
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

  updateHud(pos, itemState, altarState, net = null) {
    const d = this.dom;

    const staminaPct = (this.player.stamina / this.player.maxStamina) * 100;
    if (d.staminaFill) d.staminaFill.style.width = `${staminaPct}%`;
    if (d.staminaWrap) {
      d.staminaWrap.classList.toggle('is-spent', this.player.exhausted);
      d.staminaWrap.classList.toggle('is-full', staminaPct > 99);
    }

    if (d.pillowCount) d.pillowCount.textContent = String(this.items.collectedCount);
    if (d.torch) d.torch.classList.toggle('is-off', !this.player.flashlightOn);

    this.updatePrompt(itemState, altarState, net);
    this.updateAwareness(pos, net);
    this.updateCrewHud(net);
  }

  updateCrewHud(net) {
    const d = this.dom;
    if (!net) {
      if (d.downed) d.downed.classList.remove('is-visible');
      return;
    }

    const me = net.local();
    const down = !!(me && me.down && !me.dead);
    if (d.downed) d.downed.classList.toggle('is-visible', down);
    if (down && d.bleedFill) {
      const left = Math.max(0, Math.min(1, me.bleed / BLEED_SECONDS));
      d.bleedFill.style.width = `${(left * 100).toFixed(1)}%`;
    }

    // The roster only changes once a second or so; rebuilding it every frame
    // would be four DOM trees for nothing.
    this.crewHudTimer = (this.crewHudTimer || 0) - 1;
    if (this.crewHudTimer <= 0) {
      this.crewHudTimer = 15;
      this.renderCrewHud();
    }
  }

  updatePrompt(itemState, altarState, net = null) {
    const d = this.dom;
    if (!d.prompt) return;

    let text = null;
    let progress = 0;
    const me = net ? net.local() : null;

    if (me && (me.down || me.dead)) {
      // The downed panel says everything there is to say.
      d.prompt.classList.remove('is-visible');
      return;
    }

    if (net && net.reviveTarget) {
      // Hauling a crewmate up outranks everything else you could be doing.
      if (net.isHunter()) {
        text = `Hold [E] to make sure of ${net.reviveTarget.name}`;
        progress = net.finishProgress;
      } else {
        text = `Hold [E] to get ${net.reviveTarget.name} back up`;
        progress = net.reviveProgress;
      }
    } else if (this.player.isHidden) {
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

  updateAwareness(pos, net = null) {
    const d = this.dom;

    // Playing him, there is no ring: what he has is a nose, and it reads on
    // the same chevron the crew read him off.
    if (net && net.isHunter()) {
      if (d.awareness) d.awareness.classList.remove('is-visible');
      if (d.danger) d.danger.style.opacity = '0';
      if (d.hiddenMask) d.hiddenMask.classList.remove('is-visible');
      this.paintReuk(net);
      return;
    }

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
        const bearing = this.screenBearing(this.enemy.x - pos.x, this.enemy.z - pos.z);
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

  // Sint's lantaarntje reads one number — how far away he is — and turns it
  // into a rate. Straight-line distance, so it counts a bulkhead for nothing,
  // and no bearing, so it never does the hiding for you.
  updateLantern(delta) {
    // Sint gave the lamp to whoever went down to make the offering. The person
    // playing Mr. Geil is not that person, and it stays dark for them.
    const quiet = this.enemy.state === STATE.PACIFIED ||
      !!(this.session && this.session.isHunter());
    this.lantern.update(delta, this.enemy.distToViewer, quiet);
    if (this.lantern.ticked) horrorAudio.playLanternTick(this.lantern.proximity);
    this.paintLantern();
  }

  paintLantern() {
    const el = this.dom.lantern;
    if (!el) return;
    const lamp = this.lantern;
    el.classList.toggle('is-lit', lamp.lit);
    el.classList.toggle('is-alarm', lamp.alarm);
    // The stylesheet turns these into a brightness and a halo; the phase and
    // the rate behind them never leave this loop.
    el.style.setProperty('--glow', lamp.glow.toFixed(3));
    el.style.setProperty('--near', lamp.proximity.toFixed(3));
    // Flame flicker speed scales directly with Mr. Geil's distance/proximity (0.9s down to 0.09s).
    const flickerDur = (0.9 - lamp.proximity * 0.81).toFixed(3) + 's';
    el.style.setProperty('--flicker-dur', flickerDur);
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

  showToast(name, quote, by = null) {
    if (!this.dom.toast) return;
    this.dom.toast.innerHTML = '';

    const heading = document.createElement('strong');
    heading.textContent = by ? `${by} — ${name}` : name;
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
    if (this.state === 'INTRO') this.updateIntro(delta);

    // The camera keeps drifting toward him on the death screen.
    if (this.state === 'DEAD') {
      this.deathTimer += delta;
      const shake = Math.max(0, 0.5 - this.deathTimer) * 0.14;
      this.camera.position.x += (Math.random() - 0.5) * shake;
      this.camera.position.y += (Math.random() - 0.5) * shake;
      this.enemy.updateVisual(delta, this.player, this.enemy.distToViewer);
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
  const game = new Game();
  // A handle on the running game, for the browser console and for driving a
  // real two-browser run from a test. Nothing in the game reads it.
  window.GEIL = game;

  // ?room=ABCDE — the link the host copies out of the lobby. It opens the
  // lobby with the code already in the box rather than joining on its own, so
  // nobody is dropped into a stranger's boat by clicking a link.
  try {
    const invited = new URL(window.location.href).searchParams.get('room');
    if (invited && isValidCode(invited)) game.openLobby(invited);
  } catch (err) { /* a URL we cannot parse is not a reason to not boot */ }
});
