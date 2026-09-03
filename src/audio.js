// Sound: a recorded soundtrack over a fully synthesised sfx layer.
//
// Every effect - footsteps, the engine, the tearing paper, the jumpscare - is
// built at runtime through the Web Audio API, so the game still has a voice if
// the mp3s never arrive. The soundtrack in assets/audio is the only thing on
// disk, and it is streamed through the same graph so one volume slider governs
// the lot.
//
// Buses: master -> compressor -> destination, with ambience, sfx, the
// synthesised music box and the soundtrack underneath, so the mix can duck
// without touching individual voices.

// The soundtrack. `bed` tracks loop and crossfade into one another; the rest
// are one-shots that play over whatever is underneath.
export const TRACKS = {
  title:    { src: 'assets/audio/title.mp3',    bed: true,  gain: 0.85 },
  explore:  { src: 'assets/audio/explore.mp3',  bed: true,  gain: 0.80 },
  stalk:    { src: 'assets/audio/stalk.mp3',    bed: true,  gain: 0.95 },
  stinger:  { src: 'assets/audio/stinger.mp3',  bed: false, gain: 1.00 },
  gameover: { src: 'assets/audio/gameover.mp3', bed: false, gain: 0.95 },
  victory:  { src: 'assets/audio/victory.mp3',  bed: false, gain: 0.95 }
};

// How long the exploration bed and the stalk bed take to trade places. Long
// enough that you notice the mood turn rather than the cut.
const BED_FADE = 2.2;

class HorrorAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.volume = 0.75;

    this.threat = 0;
    this.heartRate = 52;
    this.heartVolume = 0;

    this.lastFootstep = 0;
    this.lastTear = 0;
    this.lastGeilStep = 0;
    this.lastDetected = 0;

    // Soundtrack. Built in init(); until then every music call is a no-op, so
    // the headless harness and a browser with no Audio element both survive.
    this.voices = new Map();
    this.currentBed = null;
    this.soundtrackReady = false;
  }

  init() {
    if (this.ready) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.ctx = new AudioCtx();

      // Gentle limiting so the jumpscare cannot spike into distortion.
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 6;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.22;
      this.compressor.connect(this.ctx.destination);

      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.compressor);

      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 1.0;
      this.sfx.connect(this.master);

      this.ambience = this.ctx.createGain();
      this.ambience.gain.value = 1.0;
      this.ambience.connect(this.master);

      this.music = this.ctx.createGain();
      this.music.gain.value = 0.55;
      this.music.connect(this.master);

      // The recorded soundtrack rides its own bus so a stinger can duck the
      // bed underneath it without touching the sfx.
      this.soundtrack = this.ctx.createGain();
      this.soundtrack.gain.value = 0.9;
      this.soundtrack.connect(this.master);

      this.ready = true;

      this.startEngineRumble();
      this.startDread();
      this.startHeartbeat();
      this.startMusicBox();
    } catch (err) {
      console.warn('Audio unavailable:', err);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  get t() {
    return this.ctx.currentTime;
  }

  // --- Small synth helpers ---------------------------------------------

  env(node, start, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
    node.connect(g);
    return g;
  }

  noiseBuffer(seconds) {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  burst(seconds, filterType, freq, q, peak, attack, decay, bus) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(seconds);

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;

    const now = this.t;
    const g = this.env(filter, now, peak, attack, decay);
    src.connect(filter);
    g.connect(bus || this.sfx);

    src.start(now);
    src.stop(now + seconds + 0.05);
  }

  tone(type, f0, f1, peak, attack, decay, bus) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    const now = this.t;
    osc.frequency.setValueAtTime(f0, now);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), now + attack + decay);

    const g = this.env(osc, now, peak, attack, decay);
    g.connect(bus || this.sfx);
    osc.start(now);
    osc.stop(now + attack + decay + 0.05);
  }

  // --- Continuous beds --------------------------------------------------

  // The ship itself: a slow 41 Hz reciprocating engine under everything.
  startEngineRumble() {
    const osc = this.ctx.createOscillator();
    const sub = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.value = 41;
    sub.type = 'sine';
    sub.frequency.value = 20.5;

    filter.type = 'lowpass';
    filter.frequency.value = 120;
    filter.Q.value = 1.4;

    // Slow swell, like a piston turning over.
    lfo.type = 'sine';
    lfo.frequency.value = 0.38;
    lfoGain.gain.value = 0.022;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);

    gain.gain.value = 0.055;

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(this.ambience);

    osc.start();
    sub.start();
    lfo.start();
  }

  // A dissonant pad that only becomes audible as the threat rises.
  startDread() {
    this.dreadGain = this.ctx.createGain();
    this.dreadGain.gain.value = 0;
    this.dreadGain.connect(this.ambience);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.connect(this.dreadGain);

    // A minor second: inherently unsettled.
    for (const f of [98, 103.8, 146.8]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.value = 0.07;
      osc.connect(g);
      g.connect(filter);
      osc.start();
    }
  }

  startHeartbeat() {
    const beat = () => {
      if (!this.ready) return;
      if (this.heartVolume > 0.04 && !this.muted) this.lubDub();
      const interval = (60 / this.heartRate) * 1000;
      this.heartTimer = setTimeout(beat, Math.max(220, interval));
    };
    beat();
  }

  lubDub() {
    const v = this.heartVolume;
    this.thud(this.t, 54, 0.13, v);
    this.thud(this.t + 0.15, 43, 0.2, v * 0.8);
  }

  thud(time, freq, duration, volume) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, time + duration);

    filter.type = 'lowpass';
    filter.frequency.value = 180;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.6), time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfx);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  // "Zie ginds komt de stoomboot", wrong-footed into a minor key.
  startMusicBox() {
    const notes = [440, 493.88, 523.25, 493.88, 440, 329.63, 440, 523.25, 659.25, 587.33, 523.25, 493.88, 440];
    let i = 0;

    const step = () => {
      if (!this.ready) return;
      // Falls silent when he is on you; the quiet is the tell.
      if (!this.muted && this.threat < 0.55 && this.musicEnabled !== false) {
        this.tine(notes[i % notes.length] * (Math.random() < 0.12 ? 0.5 : 1));
        i++;
      }
      this.musicTimer = setTimeout(step, 620 + Math.random() * 420);
    };
    setTimeout(step, 2500);
  }

  tine(freq) {
    const now = this.t;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    const overtone = this.ctx.createOscillator();
    overtone.type = 'sine';
    overtone.frequency.value = freq * 2.76; // inharmonic, like a struck comb

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.085, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);

    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.02, now + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    osc.connect(g);
    overtone.connect(og);
    g.connect(this.music);
    og.connect(this.music);

    osc.start(now); osc.stop(now + 1.6);
    overtone.start(now); overtone.stop(now + 0.5);
  }

  // --- The soundtrack ---------------------------------------------------
  //
  // Each track is an <audio> element routed through its own gain node, so the
  // beds can crossfade and a one-shot can duck whatever is under it. Elements
  // stream, so nothing has to be decoded up front.

  // Lazily wire one track into the graph. Returns null when the browser has no
  // Audio element (the harness) or the file cannot be routed.
  voice(name) {
    if (!this.ready || !this.soundtrack) return null;
    if (this.voices.has(name)) return this.voices.get(name);

    const spec = TRACKS[name];
    if (!spec || typeof Audio === 'undefined') return null;

    try {
      const el = new Audio(spec.src);
      el.loop = !!spec.bed;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';

      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.soundtrack);
      this.ctx.createMediaElementSource(el).connect(gain);

      const v = { el, gain, spec, fadeOutAt: 0 };
      this.voices.set(name, v);
      return v;
    } catch (err) {
      console.warn(`Track ${name} could not be routed:`, err);
      this.voices.set(name, null);
      return null;
    }
  }

  // A track is only ever started here, so a rejected play() promise - autoplay
  // policy, a missing file - degrades to silence instead of an unhandled
  // rejection, and leaves the synthesised music box carrying the scene.
  startVoice(v, fade) {
    const target = v.spec.gain;
    v.gain.gain.cancelScheduledValues(this.t);
    v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), this.t);
    v.gain.gain.linearRampToValueAtTime(target, this.t + Math.max(0.02, fade));

    const playing = v.el.currentTime > 0 && !v.el.paused && !v.el.ended;
    if (playing) return;

    const p = v.el.play();
    if (p && typeof p.catch === 'function') {
      p.catch(err => console.warn(`Track ${v.spec.src} would not start:`, err));
    }
    // The recorded score replaces the synthesised music box rather than
    // playing on top of it. If nothing ever starts, the box keeps playing.
    this.musicEnabled = false;
    this.soundtrackReady = true;
  }

  stopVoice(v, fade) {
    if (!v || v.el.paused) return;
    const at = this.t;
    v.gain.gain.cancelScheduledValues(at);
    v.gain.gain.setValueAtTime(v.gain.gain.value, at);
    v.gain.gain.linearRampToValueAtTime(0.0001, at + Math.max(0.02, fade));

    // Pause once it is actually silent, but only if nothing restarted it in
    // the meantime - the token is what makes a fade-out interruptible.
    const token = ++v.fadeOutAt;
    setTimeout(() => {
      if (v.fadeOutAt !== token) return;
      v.el.pause();
      if (!v.spec.bed) v.el.currentTime = 0;
    }, Math.max(20, fade * 1000 + 60));
  }

  // Swap the looping bed. Passing null fades the music out entirely.
  setBed(name, fade = BED_FADE) {
    if (!this.ready) return;
    if (this.currentBed === name) return;

    const previous = this.currentBed;
    this.currentBed = name;

    for (const [key, v] of this.voices) {
      if (v && v.spec.bed && key !== name) this.stopVoice(v, fade);
    }
    if (!name) return;

    const v = this.voice(name);
    if (!v) return;
    // Beds resume where they left off, except the title theme, which should
    // open on its first note every time you come back to the menu.
    if (name === 'title' && previous !== 'title') v.el.currentTime = 0;
    v.fadeOutAt++;
    this.startVoice(v, fade);
  }

  // One-shots: the ending themes and the sighting stinger. `duck` pulls the
  // bed down underneath so the cue lands.
  playCue(name, { restart = true, duck = 0, fade = 0.05 } = {}) {
    if (!this.ready || this.muted) return;
    const v = this.voice(name);
    if (!v) return;
    if (restart) v.el.currentTime = 0;
    v.fadeOutAt++;
    this.startVoice(v, fade);

    if (duck > 0 && this.soundtrack) {
      const at = this.t;
      this.soundtrack.gain.cancelScheduledValues(at);
      this.soundtrack.gain.setValueAtTime(this.soundtrack.gain.value, at);
      this.soundtrack.gain.linearRampToValueAtTime(0.9 * (1 - duck), at + 0.12);
      this.soundtrack.gain.linearRampToValueAtTime(0.9, at + 0.12 + 2.4);
    }
  }

  // He has just laid eyes on you: a sting over the top of the bed.
  playSightingStinger() {
    this.playCue('stinger', { duck: 0.45 });
  }

  playGameOverTheme() {
    this.setBed(null, 0.35);
    this.playCue('gameover', { fade: 0.2 });
  }

  playVictoryTheme() {
    this.setBed(null, 1.2);
    this.playCue('victory', { fade: 0.4 });
  }

  // Stop every ending cue, for a restart that does not wait for one to end.
  stopCues(fade = 0.3) {
    if (!this.ready) return;
    for (const [, v] of this.voices) {
      if (v && !v.spec.bed) this.stopVoice(v, fade);
    }
  }

  // --- Game hooks -------------------------------------------------------

  // 0 = calm, 1 = he is on you. Drives heartbeat and the dread pad.
  setThreat(level) {
    this.threat = Math.max(0, Math.min(1, level));
    this.heartVolume = this.threat < 0.12 ? 0 : this.threat * 0.75;
    this.heartRate = 52 + this.threat * 108;
    if (this.dreadGain && this.ctx) {
      this.dreadGain.gain.setTargetAtTime(this.threat * 0.16, this.t, 0.4);
    }
  }

  playFootstep(gait = 'walk') {
    if (!this.ready || this.muted) return;
    const now = this.t;
    const minGap = gait === 'sprint' ? 0.24 : gait === 'sneak' ? 0.6 : 0.34;
    if (now - this.lastFootstep < minGap) return;
    this.lastFootstep = now;

    const vol = gait === 'sprint' ? 0.16 : gait === 'sneak' ? 0.035 : 0.09;
    // Deck creak plus the scuff of a sole.
    this.tone('triangle', 118 + Math.random() * 34, 34, vol, 0.005, 0.11);
    this.burst(0.09, 'bandpass', 1600 + Math.random() * 900, 1.2, vol * 0.5, 0.004, 0.07);
  }

  // Mr. Geil's own footfalls: heavier, wetter, and attenuated by distance so
  // the player can track him by ear alone.
  playGeilStep(dist, chasing) {
    if (!this.ready || this.muted) return;
    const now = this.t;
    if (now - this.lastGeilStep < 0.16) return;
    this.lastGeilStep = now;

    const falloff = Math.max(0, 1 - dist / 26);
    const vol = falloff * falloff * (chasing ? 0.32 : 0.2);
    if (vol < 0.004) return;

    this.tone('sine', 74 + Math.random() * 18, 28, vol, 0.006, 0.19);
    this.burst(0.14, 'lowpass', 380, 0.9, vol * 0.7, 0.006, 0.12);
  }

  // He has seen you.
  playDetected() {
    if (!this.ready || this.muted) return;
    const now = this.t;
    if (now - this.lastDetected < 1.5) return;
    this.lastDetected = now;

    this.tone('sawtooth', 880, 180, 0.16, 0.008, 0.55);
    this.tone('square', 233, 116, 0.1, 0.01, 0.7);
    this.burst(0.5, 'highpass', 2200, 0.7, 0.1, 0.005, 0.45);
  }

  // He has heard something and is coming to look.
  playAlerted() {
    if (!this.ready || this.muted) return;
    this.tone('sine', 320, 180, 0.07, 0.02, 0.6);
  }

  playMonsterGrowl(intensity = 1) {
    if (!this.ready || this.muted) return;
    const now = this.t;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(62 + Math.random() * 12, now);
    osc.frequency.linearRampToValueAtTime(41, now + 0.75);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(240, now);
    filter.Q.value = 5;

    const peak = 0.2 * intensity;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfx);
    osc.start(now);
    osc.stop(now + 0.85);
  }

  // Rate-limited paper tearing while a present is being opened.
  playTear(progress) {
    if (!this.ready || this.muted) return;
    const now = this.t;
    if (now - this.lastTear < 0.1) return;
    this.lastTear = now;
    this.burst(0.09, 'highpass', 1800 + progress * 2600, 0.8, 0.045 + progress * 0.05, 0.004, 0.07);
  }

  playUnwrap() {
    if (!this.ready || this.muted) return;
    this.burst(0.3, 'highpass', 1500, 0.6, 0.16, 0.006, 0.26);
    this.tone('triangle', 180, 90, 0.1, 0.01, 0.3);
    setTimeout(() => this.playPillowChime(), 140);
  }

  playPillowChime() {
    if (!this.ready || this.muted) return;
    const now = this.t;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const at = now + i * 0.06;
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.1, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
      osc.connect(g);
      g.connect(this.sfx);
      osc.start(at);
      osc.stop(at + 0.75);
    });
  }

  playRustle() {
    if (!this.ready || this.muted) return;
    this.burst(0.24, 'bandpass', 2400, 0.9, 0.07, 0.01, 0.2);
  }

  playClick() {
    if (!this.ready || this.muted) return;
    this.burst(0.03, 'highpass', 3200, 1.5, 0.06, 0.001, 0.02);
  }

  playTributeSuccess() {
    if (!this.ready || this.muted) return;
    const now = this.t;
    // A major cadence, finally.
    [261.63, 329.63, 392.0, 523.25, 659.25].forEach((freq, i) => {
      [1, 2].forEach(mult => {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        const at = now + i * 0.13;
        osc.type = mult === 1 ? 'triangle' : 'sine';
        osc.frequency.value = freq * mult;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.11 / mult, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 1.6);
        osc.connect(g);
        g.connect(this.sfx);
        osc.start(at);
        osc.stop(at + 1.7);
      });
    });
  }

  playJumpscare() {
    if (!this.ready) return;
    this.resume();
    const now = this.t;

    // Transient crack.
    this.burst(0.45, 'highpass', 900, 0.4, 0.85, 0.001, 0.4);

    // Descending shriek.
    const shriek = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    const sf = this.ctx.createBiquadFilter();
    shriek.type = 'sawtooth';
    shriek.frequency.setValueAtTime(1800, now);
    shriek.frequency.exponentialRampToValueAtTime(90, now + 1.1);
    sf.type = 'bandpass';
    sf.frequency.value = 1200;
    sf.Q.value = 2;
    sg.gain.setValueAtTime(0.5, now);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    shriek.connect(sf); sf.connect(sg); sg.connect(this.sfx);
    shriek.start(now); shriek.stop(now + 1.25);

    // Sub drop you feel more than hear.
    const sub = this.ctx.createOscillator();
    const subg = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, now);
    sub.frequency.exponentialRampToValueAtTime(24, now + 1.6);
    subg.gain.setValueAtTime(0.6, now);
    subg.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    sub.connect(subg); subg.connect(this.sfx);
    sub.start(now); sub.stop(now + 1.85);

    this.setThreat(0);
  }
}

export const horrorAudio = new HorrorAudio();
