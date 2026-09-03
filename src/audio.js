// Procedural Horror Sound Synthesizer using Web Audio API
// 100% self-contained, no external audio files required!

class HorrorAudio {
  constructor() {
    this.ctx = null;
    this.initialized = false;
    this.masterGain = null;
    this.engineNode = null;
    this.engineGain = null;
    this.heartbeatTimer = null;
    this.heartbeatBpm = 60;
    this.heartbeatVolume = 0;
    this.musicBoxInterval = null;
    this.isMuted = false;
    this.lastFootstepTime = 0;
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.8, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
      this.initialized = true;

      this.startAmbientEngine();
      this.startHeartbeatLoop();
      this.startSpookyMusicBox();
    } catch (e) {
      console.warn("AudioContext init error:", e);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.8, this.ctx.currentTime);
    }
    return this.isMuted;
  }

  // Low 42Hz engine rumble and ship vibration
  startAmbientEngine() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    this.engineGain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(42, this.ctx.currentTime);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(84, this.ctx.currentTime);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(110, this.ctx.currentTime);

    this.engineGain.gain.setValueAtTime(0.25, this.ctx.currentTime);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    osc.start();
    osc2.start();
    this.engineNode = { osc, osc2, filter };
  }

  // Footsteps on wooden ship deck
  playFootstep() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastFootstepTime < 0.28) return;
    this.lastFootstepTime = now;

    // Wood creak thud
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120 + Math.random() * 40, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.12);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(250 + Math.random() * 80, now);
    filter.Q.setValueAtTime(3, now);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.14);
  }

  // Creepy music box: "Zie ginds komt de stoomboot" motif in a minor key
  startSpookyMusicBox() {
    const notes = [
      440, 493.88, 523.25, 493.88, 440, 329.63, 440, 523.25, 659.25, 587.33, 523.25, 493.88, 440
    ];
    let noteIdx = 0;

    const playNextNote = () => {
      if (!this.ctx || this.isMuted) {
        setTimeout(playNextNote, 1000);
        return;
      }
      if (Math.random() < 0.22) {
        setTimeout(playNextNote, 1400);
        return;
      }

      const freq = notes[noteIdx % notes.length];
      noteIdx++;
      this.playTine(freq * (Math.random() < 0.15 ? 2 : 1), 0.08);

      const delay = 400 + Math.random() * 150;
      setTimeout(playNextNote, delay);
    };

    setTimeout(playNextNote, 2500);
  }

  playTine(freq, vol = 0.1) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq + (Math.random() - 0.5) * 4, now);

    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.85);
  }

  // Dynamic Heartbeat when Mr. Geil is near
  updateHeartbeat(distance) {
    if (!this.ctx) return;
    const maxDist = 22.0;
    if (distance > maxDist) {
      this.heartbeatVolume = 0;
      return;
    }

    const t = 1.0 - Math.min(1.0, distance / maxDist);
    this.heartbeatVolume = t * 0.7;
    // Speed increases as monster approaches: 60 BPM up to 165 BPM
    this.heartbeatBpm = 60 + t * 105;
  }

  startHeartbeatLoop() {
    const beat = () => {
      if (this.ctx && this.heartbeatVolume > 0.05 && !this.isMuted) {
        this.playLubDub();
      }
      const intervalMs = (60 / this.heartbeatBpm) * 1000;
      setTimeout(beat, Math.max(250, intervalMs));
    };
    beat();
  }

  playLubDub() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const vol = this.heartbeatVolume;

    // Lub
    this.playThud(now, 55, 0.12, vol);
    // Dub
    this.playThud(now + 0.14, 45, 0.18, vol * 0.85);
  }

  playThud(time, freq, duration, volume) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(20, time + duration);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(90, time);

    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + duration);
  }

  // Sound when unwrapping a Sint gift box
  playUnwrap() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    const bufferSize = Math.floor(this.ctx.sampleRate * 0.35);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.linearRampToValueAtTime(3200, now + 0.3);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(now);
    noise.stop(now + 0.36);

    setTimeout(() => {
      this.playPillowChime();
    }, 200);
  }

  // Heavenly anime body pillow reveal chime
  playPillowChime() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const arpeggio = [523.25, 659.25, 783.99, 1046.5, 1318.51];

    arpeggio.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);

      gain.gain.setValueAtTime(0.18, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.8);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.85);
    });
  }

  // Monster proximity creepy hiss/growl
  playMonsterGrowl() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(65, now);
    osc.frequency.linearRampToValueAtTime(45, now + 0.6);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(220, now);
    filter.Q.setValueAtTime(4, now);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.65);
  }

  // Jumpscare stinger when Mr. Geil eats you!
  playJumpscare() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const freqs = [210, 225, 430, 465, 880, 920];
    freqs.forEach(freq => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.8);

      gain.gain.setValueAtTime(0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 1.3);
    });

    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(100, now);
    subOsc.frequency.exponentialRampToValueAtTime(20, now + 0.9);

    subGain.gain.setValueAtTime(0.9, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

    subOsc.connect(subGain);
    subGain.connect(this.masterGain);

    subOsc.start(now);
    subOsc.stop(now + 1.1);
  }

  // Glorious celestial victory fanfare when Mr. Geil is pleased
  playTributeSuccess() {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const chordFreqs = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99];

    chordFreqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.05);

      gain.gain.setValueAtTime(0.2, now + idx * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 3.0);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now + idx * 0.05);
      osc.stop(now + 3.2);
    });
  }
}

export const horrorAudio = new HorrorAudio();
