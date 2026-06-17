/**
 * Web Audio API based Synthesizer for PixieChess.
 * All sounds are procedurally generated to avoid asset loading.
 * Sounds are tuned to be subtle, short, and non-irritating.
 */

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.15; // Global volume - kept very low and subtle
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function createNoiseBuffer(): AudioBuffer | null {
  if (!audioCtx) return null;
  const bufferSize = audioCtx.sampleRate * 1; // 1 second buffer
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export const soundEngine = {
  playMove() {
    initAudio();
    if (!audioCtx || !masterGain) return;
    const t = audioCtx.currentTime;
    
    // Soft wooden thud: low frequency sine dropping fast
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.7, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
    
    osc.connect(gain);
    gain.connect(masterGain);
    
    osc.start(t);
    osc.stop(t + 0.15);
  },

  playCapture() {
    initAudio();
    if (!audioCtx || !masterGain) return;
    const t = audioCtx.currentTime;
    
    // Sharp crack: Noise + high sine
    const osc = audioCtx.createOscillator();
    const oscGain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.1);
    oscGain.gain.setValueAtTime(0, t);
    oscGain.gain.linearRampToValueAtTime(0.8, t + 0.01);
    oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
    osc.connect(oscGain);
    oscGain.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.15);

    // Noise layer
    const noise = audioCtx.createBufferSource();
    noise.buffer = createNoiseBuffer();
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.5, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
    noise.connect(noiseGain);
    noiseGain.connect(masterGain);
    noise.start(t);
    noise.stop(t + 0.15);
  },

  playZap() {
    initAudio();
    if (!audioCtx || !masterGain) return;
    const t = audioCtx.currentTime;
    
    // Electroknight: Descending sawtooth (like a quick electric zap)
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.2);
    
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
    
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.25);
  },

  playGunshot() {
    initAudio();
    if (!audioCtx || !masterGain) return;
    const t = audioCtx.currentTime;
    
    // Gunslinger: Sharp noise burst + low kick
    const noise = audioCtx.createBufferSource();
    noise.buffer = createNoiseBuffer();
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0, t);
    noiseGain.gain.linearRampToValueAtTime(0.6, t + 0.01);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
    
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + 0.2);
    
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noise.start(t);
    noise.stop(t + 0.25);

    // Kick punch
    const osc = audioCtx.createOscillator();
    const oscGain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    oscGain.gain.setValueAtTime(0, t);
    oscGain.gain.linearRampToValueAtTime(0.5, t + 0.01);
    oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
    osc.connect(oscGain);
    oscGain.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.2);
  },

  playThud() {
    initAudio();
    if (!audioCtx || !masterGain) return;
    const t = audioCtx.currentTime;
    
    // SumoRook: Heavy, slow drop
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(100, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.2);
    
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.8, t + 0.05);
    gain.gain.linearRampToValueAtTime(0.01, t + 0.3);
    
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.35);
  },

  playExplosion() {
    initAudio();
    if (!audioCtx || !masterGain) return;
    const t = audioCtx.currentTime;
    
    // Fission / Rocketman: Long rumbling noise
    const noise = audioCtx.createBufferSource();
    noise.buffer = createNoiseBuffer();
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0, t);
    noiseGain.gain.linearRampToValueAtTime(0.6, t + 0.1);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.6);
    
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(100, t + 0.6);
    
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noise.start(t);
    noise.stop(t + 0.7);
  },

  playPromote() {
    initAudio();
    if (!audioCtx || !masterGain) return;
    const t = audioCtx.currentTime;
    
    // Rising arpeggio (C E G)
    const freqs = [261.63, 329.63, 392.00];
    freqs.forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      
      osc.type = 'sine';
      osc.frequency.value = freq;
      
      const startTime = t + (i * 0.1);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.4, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);
      
      osc.connect(gain);
      gain.connect(masterGain!);
      osc.start(startTime);
      osc.stop(startTime + 0.5);
    });
  },

  playWin() {
    initAudio();
    if (!audioCtx || !masterGain) return;
    const t = audioCtx.currentTime;
    
    // Triumphant major chord (C E G C)
    const freqs = [261.63, 329.63, 392.00, 523.25];
    freqs.forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      
      osc.type = 'triangle';
      osc.frequency.value = freq;
      
      const startTime = t + (i * 0.1);
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.8);
      
      osc.connect(gain);
      gain.connect(masterGain!);
      osc.start(startTime);
      osc.stop(startTime + 0.9);
    });
  }
};
