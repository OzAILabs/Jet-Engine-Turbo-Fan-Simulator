/**
 * Procedural turbofan audio built from live Web Audio nodes.
 *
 * The layers intentionally represent different physical sources:
 * - LP fan blade-pass tone and harmonics
 * - HP compressor whine
 * - low machinery rumble
 * - broadband intake and exhaust turbulence
 * - high-frequency jet hiss
 *
 * No recorded samples are required. All parameters are smoothly driven from
 * the live simulation state so throttle transients and spool coast-down remain
 * synchronized with the model.
 */

export interface EngineAudioFrame {
  n1: number;
  n2: number;
  lpRpm: number;
  hpRpm: number;
  thrustFraction: number;
  massFlowFraction: number;
  coreVelocityFraction: number;
  bypassVelocityFraction: number;
  fuelFraction: number;
}

interface ToneLayer {
  oscillator: OscillatorNode;
  gain: GainNode;
}

interface NoiseLayer {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

const PARAM_SMOOTHING_SECONDS = 0.08;

/**
 * Revert switch for the experimental low-frequency jet roar layer.
 * Set to false to return to the original procedural mix exactly.
 */
const ENABLE_LOW_JET_ROAR = true;

function setSmooth(param: AudioParam, value: number, now: number, seconds = PARAM_SMOOTHING_SECONDS) {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, seconds);
}

function createNoiseBuffer(context: AudioContext, seconds = 2): AudioBuffer {
  const length = Math.ceil(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);

  // Slightly correlated noise avoids the brittle sound of pure white noise.
  let previous = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    previous = previous * 0.18 + white * 0.82;
    data[i] = previous;
  }
  return buffer;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function createSoftClipCurve(size = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.45) / Math.tanh(1.45);
  }
  return curve;
}

class ProceduralEngineAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private fanTone: ToneLayer | null = null;
  private fanHarmonic: ToneLayer | null = null;
  private hpTone: ToneLayer | null = null;
  private subRoar: ToneLayer | null = null;
  private rumble: NoiseLayer | null = null;
  private lowRoar: NoiseLayer | null = null;
  private roarBody: NoiseLayer | null = null;
  private roarTear: NoiseLayer | null = null;
  private intake: NoiseLayer | null = null;
  private exhaust: NoiseLayer | null = null;
  private hiss: NoiseLayer | null = null;
  private enabled = false;
  private volume = 0.55;

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    if (enabled) {
      this.ensureGraph();
      await this.context?.resume();
    }
    this.applyMaster();
  }

  setVolume(volume: number) {
    const next = Math.max(0, Math.min(1, volume));
    if (next === this.volume) return;
    this.volume = next;
    this.applyMaster();
  }

  update(frame: EngineAudioFrame) {
    const context = this.context;
    if (!context || !this.enabled || !this.fanTone || !this.fanHarmonic || !this.hpTone || !this.subRoar) return;
    if (!this.rumble || !this.lowRoar || !this.roarBody || !this.roarTear || !this.intake || !this.exhaust || !this.hiss) return;

    const now = context.currentTime;
    const n1 = Math.max(0, Math.min(1.1, frame.n1));
    const n2 = Math.max(0, Math.min(1.1, frame.n2));
    const thrust = Math.max(0, Math.min(1.2, frame.thrustFraction));
    const mass = Math.max(0, Math.min(1.2, frame.massFlowFraction));
    const coreVelocity = Math.max(0, Math.min(1.4, frame.coreVelocityFraction));
    const bypassVelocity = Math.max(0, Math.min(1.4, frame.bypassVelocityFraction));
    const fuel = Math.max(0, Math.min(1.2, frame.fuelFraction));

    // Actual blade-pass frequencies are used where practical. The HP tone is
    // folded into an audible range while retaining its nonlinear spool sweep.
    const fanBladePassHz = Math.max(28, (frame.lpRpm / 60) * 22);
    const hpBladePassHz = Math.max(70, (frame.hpRpm / 60) * 46);
    const hpAudibleHz = 340 + Math.pow(n2, 1.7) * 3450 + (hpBladePassHz % 240) * 0.12;

    setSmooth(this.fanTone.oscillator.frequency, fanBladePassHz, now, 0.055);
    setSmooth(this.fanHarmonic.oscillator.frequency, fanBladePassHz * 2.02, now, 0.055);
    setSmooth(this.hpTone.oscillator.frequency, hpAudibleHz, now, 0.045);

    setSmooth(this.fanTone.gain.gain, 0.015 + Math.pow(n1, 1.25) * 0.075, now);
    setSmooth(this.fanHarmonic.gain.gain, Math.pow(n1, 1.8) * 0.025, now);
    setSmooth(this.hpTone.gain.gain, Math.pow(n2, 1.9) * 0.035, now);

    setSmooth(this.rumble.filter.frequency, 75 + n1 * 150, now);
    setSmooth(this.rumble.gain.gain, 0.025 + n1 * 0.055 + fuel * 0.018, now);

    // Separate staged jet-roar system. The slow, non-matching modulation rates
    // keep it rolling and uneven rather than sounding like a loop or bass note.
    const roarDrive = ENABLE_LOW_JET_ROAR ? Math.pow(Math.max(thrust, mass * 0.86), 1.08) : 0;
    const idleBreath = 0.9 + 0.07 * Math.sin(now * 1.35) + 0.03 * Math.sin(now * 2.17 + 1.2);
    const midSpool = smoothstep(0.28, 0.58, n1) * (1 - smoothstep(0.82, 1.04, n1));
    const pressurePulse = 0.82 + midSpool * (0.13 * Math.sin(now * 4.2) + 0.05 * Math.sin(now * 6.7 + 0.8));
    const highPower = smoothstep(0.58, 0.98, Math.max(thrust, mass));
    const chaos =
      0.82 +
      highPower * (0.11 * Math.sin(now * 2.73 + 0.4) + 0.07 * Math.sin(now * 7.19) + 0.04 * Math.sin(now * 13.7 + 2.1));
    const rollingDrive = Math.max(0.45, idleBreath * pressurePulse * chaos);

    // Foundation: rounded idle whummm that expands into broad pressure.
    setSmooth(this.lowRoar.filter.frequency, 95 + thrust * 165, now);
    setSmooth(this.lowRoar.filter.Q, 0.4 + thrust * 0.3, now);
    setSmooth(this.lowRoar.gain.gain, roarDrive * rollingDrive * (0.2 + highPower * 0.16), now, 0.11);
    setSmooth(this.subRoar.oscillator.frequency, 31 + n1 * 25 + thrust * 15, now, 0.12);
    setSmooth(this.subRoar.gain.gain, roarDrive * idleBreath * (0.025 + highPower * 0.018), now, 0.14);

    // Body: chest-pressure band, strongest from mid-spool through full power.
    setSmooth(this.roarBody.filter.frequency, 190 + thrust * 290, now);
    setSmooth(this.roarBody.filter.Q, 0.45 + highPower * 0.3, now);
    setSmooth(this.roarBody.gain.gain, roarDrive * pressurePulse * (0.09 + highPower * 0.18), now, 0.09);

    // Turbulent tearing texture enters only as the exhaust becomes energetic.
    setSmooth(this.roarTear.filter.frequency, 480 + coreVelocity * 720, now);
    setSmooth(this.roarTear.filter.Q, 0.38 + highPower * 0.25, now);
    setSmooth(this.roarTear.gain.gain, roarDrive * highPower * chaos * 0.12, now, 0.065);

    setSmooth(this.intake.filter.frequency, 240 + n1 * 1150, now);
    setSmooth(this.intake.filter.Q, 0.45 + n1 * 0.8, now);
    setSmooth(this.intake.gain.gain, Math.pow(mass, 1.3) * 0.11, now);

    setSmooth(this.exhaust.filter.frequency, 150 + coreVelocity * 720, now);
    setSmooth(this.exhaust.filter.Q, 0.35 + thrust * 0.45, now);
    setSmooth(this.exhaust.gain.gain, Math.pow(thrust, 1.15) * 0.14, now);

    setSmooth(this.hiss.filter.frequency, 1800 + bypassVelocity * 4100, now);
    setSmooth(this.hiss.gain.gain, Math.pow(Math.max(coreVelocity, bypassVelocity), 1.8) * 0.06, now);
  }

  private ensureGraph() {
    if (this.context) return;

    const Context = window.AudioContext ?? window.webkitAudioContext;
    const context = new Context();
    this.context = context;

    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.2;
    master.connect(compressor).connect(context.destination);
    this.master = master;

    // The experimental roar layers share a gently saturated bus. This thickens
    // broadband turbulence without altering the established fan/compressor mix.
    const roarBus = context.createGain();
    const roarShelf = context.createBiquadFilter();
    const roarSaturation = context.createWaveShaper();
    roarShelf.type = 'lowshelf';
    roarShelf.frequency.value = 230;
    roarShelf.gain.value = 4;
    roarSaturation.curve = createSoftClipCurve();
    roarSaturation.oversample = '2x';
    roarBus.connect(roarShelf).connect(roarSaturation).connect(master);

    this.fanTone = this.createTone(context, master, 'sine');
    this.fanHarmonic = this.createTone(context, master, 'triangle');
    this.hpTone = this.createTone(context, master, 'sine');
    this.subRoar = this.createTone(context, roarBus, 'sine');

    const noiseBuffer = createNoiseBuffer(context);
    this.rumble = this.createNoise(context, master, noiseBuffer, 'lowpass', 130);
    this.lowRoar = this.createNoise(context, roarBus, createNoiseBuffer(context, 2.7), 'lowpass', 160);
    this.roarBody = this.createNoise(context, roarBus, createNoiseBuffer(context, 3.1), 'bandpass', 320);
    this.roarTear = this.createNoise(context, roarBus, createNoiseBuffer(context, 2.3), 'bandpass', 760);
    this.intake = this.createNoise(context, master, noiseBuffer, 'bandpass', 650);
    this.exhaust = this.createNoise(context, master, noiseBuffer, 'bandpass', 420);
    this.hiss = this.createNoise(context, master, noiseBuffer, 'highpass', 2800);

    this.applyMaster();
  }

  private createTone(context: AudioContext, destination: AudioNode, type: OscillatorType): ToneLayer {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    gain.gain.value = 0;
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    return { oscillator, gain };
  }

  private createNoise(
    context: AudioContext,
    destination: AudioNode,
    buffer: AudioBuffer,
    type: BiquadFilterType,
    frequency: number,
  ): NoiseLayer {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = 0.7;
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(destination);
    source.start();
    return { source, filter, gain };
  }

  private applyMaster() {
    if (!this.context || !this.master) return;
    const target = this.enabled ? this.volume : 0;
    setSmooth(this.master.gain, target, this.context.currentTime, 0.035);
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export const engineAudio = new ProceduralEngineAudio();
