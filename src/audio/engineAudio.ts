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

import type { EngineRunState } from '../sim/startSequence';

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
  /** Start/shutdown sequence state — drives the sub-idle soundscape. */
  runState: EngineRunState;
  starterEngaged: boolean;
  ignitionOn: boolean;
  lit: boolean;
  /** Displayed EGT [°C] (start peak ~550–630, idle ~440). */
  egtC: number;
  /** Displayed fuel flow [kg/s] (light-off ~0.14, idle ~0.25). */
  fuelFlowKgs: number;
}

interface ToneLayer {
  oscillator: OscillatorNode;
  gain: GainNode;
}

interface FilteredToneLayer {
  oscillator: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

/** Two detuned oscillators sharing a narrow bandpass — a slow-beating drone. */
interface DualToneLayer {
  oscA: OscillatorNode;
  oscB: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

interface NoiseLayer {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

const PARAM_SMOOTHING_SECONDS = 0.08;

/** Air-turbine starter audio: crank range over which the whine sweeps. */
const STARTER_CRANK_N2 = 0.65;
/** Igniter spark repetition (~6 Hz) and the look-ahead scheduling horizon. */
const IGNITER_INTERVAL_S = 1 / 6;
const IGNITER_LOOKAHEAD_S = 0.2;

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

/**
 * Igniter spark click: a ~3 ms noise burst with the attack/decay envelope baked
 * into the buffer, so playback needs no AudioParam automation at all.
 */
function createIgniterClickBuffer(context: AudioContext): AudioBuffer {
  const length = Math.max(16, Math.ceil(context.sampleRate * 0.006));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  const attack = Math.max(1, Math.floor(length * 0.12));
  for (let i = 0; i < length; i++) {
    const envelope = i < attack ? i / attack : Math.exp(-(i - attack) / (length * 0.2));
    data[i] = (Math.random() * 2 - 1) * envelope;
  }
  return buffer;
}

/**
 * Light-off "whoomph": pre-rendered low-frequency noise swell (~60–200 Hz,
 * fast attack then ~0.8 s decay), normalized so the bus gain sets the level.
 */
function createWhoomphBuffer(context: AudioContext): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = Math.ceil(sampleRate * 1.1);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  // Two cascaded one-pole lowpasses (~200 Hz) minus a one-pole lowpass
  // (~55 Hz) confine white noise to roughly the 60–200 Hz band.
  const lpCoeff = Math.exp((-2 * Math.PI * 200) / sampleRate);
  const hpCoeff = Math.exp((-2 * Math.PI * 55) / sampleRate);
  let lp1 = 0;
  let lp2 = 0;
  let low = 0;
  const attackSeconds = 0.14;
  const decaySeconds = 0.32;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const white = Math.random() * 2 - 1;
    lp1 = lp1 * lpCoeff + white * (1 - lpCoeff);
    lp2 = lp2 * lpCoeff + lp1 * (1 - lpCoeff);
    low = low * hpCoeff + lp2 * (1 - hpCoeff);
    const banded = lp2 - low;
    const envelope =
      t < attackSeconds
        ? (t / attackSeconds) * (t / attackSeconds)
        : Math.exp(-(t - attackSeconds) / decaySeconds);
    const sample = banded * envelope;
    data[i] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  if (peak > 0) {
    const norm = 1 / peak;
    for (let i = 0; i < length; i++) data[i] *= norm;
  }
  return buffer;
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

  // --- Start-sequence layers -----------------------------------------------
  /** Air-turbine starter: clean whine + gritty detuned partner + air rush. */
  private starterSine: ToneLayer | null = null;
  private starterSaw: FilteredToneLayer | null = null;
  private starterAir: NoiseLayer | null = null;
  /** GE90 sub-idle VBV "whine-grind" drone (10 open variable bleed valves). */
  private vbvDrone: DualToneLayer | null = null;
  /** Combustion rumble — fuel/EGT-driven so the burn is audible sub-idle. */
  private combustion: NoiseLayer | null = null;
  /** One-shot buses: their gains are FIXED — update() never automates them, so
   * scheduled AudioBufferSourceNodes are never clobbered by setSmooth(). */
  private igniterInput: BiquadFilterNode | null = null;
  private igniterBuffer: AudioBuffer | null = null;
  private whoomphInput: BiquadFilterNode | null = null;
  private whoomphBuffer: AudioBuffer | null = null;

  // Per-frame memory for edge detection and look-ahead scheduling.
  private prevLit = false;
  private nextIgniterTime = 0;

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
    if (!this.starterSine || !this.starterSaw || !this.starterAir || !this.vbvDrone || !this.combustion) return;

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
    // No frequency floors: everything sweeps to 0 Hz as the spools stop. The
    // smoothstep "presence" gates re-create the old fixed offsets at/above
    // idle (so the running mix is untouched) but reach TRUE zero when parked.
    const fanPresence = smoothstep(0.03, 0.1, n1);
    const fanBladePassHz = (frame.lpRpm / 60) * 22;
    const hpBladePassHz = (frame.hpRpm / 60) * 46;
    const hpAudibleHz = 340 * smoothstep(0, 0.06, n2) + Math.pow(n2, 1.7) * 3450 + (hpBladePassHz % 240) * 0.12;

    setSmooth(this.fanTone.oscillator.frequency, fanBladePassHz, now, 0.055);
    setSmooth(this.fanHarmonic.oscillator.frequency, fanBladePassHz * 2.02, now, 0.055);
    setSmooth(this.hpTone.oscillator.frequency, hpAudibleHz, now, 0.045);

    setSmooth(this.fanTone.gain.gain, fanPresence * (0.015 + Math.pow(n1, 1.25) * 0.075), now);
    setSmooth(this.fanHarmonic.gain.gain, fanPresence * Math.pow(n1, 1.8) * 0.025, now);
    setSmooth(this.hpTone.gain.gain, Math.pow(n2, 1.9) * 0.035, now);

    setSmooth(this.rumble.filter.frequency, 75 + n1 * 150, now);
    setSmooth(this.rumble.gain.gain, fanPresence * (0.025 + n1 * 0.055) + fuel * 0.018, now);

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

    // --- Air-turbine starter -------------------------------------------------
    // The whine sweeps with N2 across the crank range and is only present while
    // the start valve is open; at cutout (~63% N2) it fades over about a second.
    const crank = Math.max(0, Math.min(1, n2 / STARTER_CRANK_N2));
    const starterHz = 180 + Math.pow(crank, 1.15) * 1220; // ~180 → ~1400 Hz
    setSmooth(this.starterSine.oscillator.frequency, starterHz, now, 0.06);
    setSmooth(this.starterSaw.oscillator.frequency, starterHz * 1.007, now, 0.06);
    setSmooth(this.starterSaw.filter.frequency, Math.max(180, starterHz * 1.9), now, 0.06);
    const starterLevel = frame.starterEngaged ? 0.3 + 0.7 * crank : 0;
    const starterFade = frame.starterEngaged ? 0.15 : 0.3; // release tau ⇒ ~1 s fade-out
    setSmooth(this.starterSine.gain.gain, starterLevel * 0.05, now, starterFade);
    setSmooth(this.starterSaw.gain.gain, starterLevel * 0.03, now, starterFade);
    setSmooth(this.starterAir.filter.frequency, 650 + crank * 500, now);
    setSmooth(this.starterAir.gain.gain, (frame.starterEngaged ? crank : 0) * 0.06, now, starterFade);

    // --- VBV "whine-grind" drone ---------------------------------------------
    // The GE90's 10 open variable bleed valves give the famous sub-idle groan.
    // Present between ~10% and idle N2, gone once the VBVs close at idle.
    const vbvBand = smoothstep(0.1, 0.2, n2) * (1 - smoothstep(0.58, 0.655, n2));
    const vbvHz = 320 * (0.94 + 0.12 * n2);
    setSmooth(this.vbvDrone.oscA.frequency, vbvHz, now, 0.09);
    setSmooth(this.vbvDrone.oscB.frequency, vbvHz * 1.0045, now, 0.09); // ~1.5 Hz beat
    setSmooth(this.vbvDrone.filter.frequency, vbvHz, now, 0.09);
    const vbvGrind = 0.85 + 0.15 * Math.sin(now * 2.4); // slow uneven waver
    setSmooth(this.vbvDrone.gain.gain, vbvBand * vbvGrind * 0.04, now, 0.12);

    // --- Combustion rumble ---------------------------------------------------
    // Driven by fuel flow and EGT — NOT thrust — so the burn is audible from
    // light-off all the way to idle, then hands off to the thrust-keyed roar.
    const fuelNorm = Math.max(0, Math.min(1, frame.fuelFlowKgs / 0.25));
    const egtNorm = Math.max(0, Math.min(1, frame.egtC / 650));
    const burning = frame.lit && frame.runState !== 'spooldown';
    const idleHandoff = 1 - smoothstep(0.22, 0.5, n1); // roar stack takes over above idle
    const burnDrive = burning ? fuelNorm * (0.35 + 0.65 * egtNorm) : 0;
    const burnFade = burning ? 0.3 : 0.15; // fuel chop ⇒ ~0.5 s fade
    setSmooth(this.combustion.filter.frequency, 75 + egtNorm * 95, now);
    setSmooth(this.combustion.gain.gain, burnDrive * idleHandoff * 0.1, now, burnFade);

    // --- Igniter ticks (look-ahead scheduled one-shots) ------------------------
    if (frame.ignitionOn) {
      if (this.nextIgniterTime < now + 0.01) this.nextIgniterTime = now + 0.03;
      const horizon = now + IGNITER_LOOKAHEAD_S;
      while (this.nextIgniterTime < horizon) {
        this.fireOneShot(this.igniterBuffer, this.igniterInput, this.nextIgniterTime);
        this.nextIgniterTime += IGNITER_INTERVAL_S;
      }
    } else {
      this.nextIgniterTime = 0;
    }

    // --- Light-off whoomph (false → true edge on the flame flag) ---------------
    // Gated to the start states so enabling audio mid-flight (or snapping to a
    // running preset) cannot fire a spurious burst.
    const inLightoffWindow = frame.runState === 'fuelOn' || frame.runState === 'lightoff';
    if (frame.lit && !this.prevLit && inLightoffWindow) {
      this.fireOneShot(this.whoomphBuffer, this.whoomphInput, now);
    }
    this.prevLit = frame.lit;
  }

  /** Play a pre-rendered one-shot through its dedicated (never-automated) bus. */
  private fireOneShot(buffer: AudioBuffer | null, input: AudioNode | null, when: number) {
    const context = this.context;
    if (!context || !buffer || !input) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(input);
    source.onended = () => source.disconnect();
    source.start(Math.max(when, context.currentTime));
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

    // --- Start-sequence layers ---------------------------------------------
    this.starterSine = this.createTone(context, master, 'sine');
    this.starterSaw = this.createFilteredTone(context, master, 'sawtooth', 360, 4);
    this.starterAir = this.createNoise(context, master, noiseBuffer, 'bandpass', 900);
    this.vbvDrone = this.createVbvDrone(context, master);
    this.combustion = this.createNoise(context, master, createNoiseBuffer(context, 2.1), 'lowpass', 110);

    // One-shot buses. Their gain values are constants set once here; update()
    // never calls setSmooth() on them, so cancelScheduledValues can never
    // strip a scheduled click/whoomph.
    this.igniterBuffer = createIgniterClickBuffer(context);
    const igniterFilter = context.createBiquadFilter();
    igniterFilter.type = 'highpass';
    igniterFilter.frequency.value = 2600;
    igniterFilter.Q.value = 0.7;
    const igniterGain = context.createGain();
    igniterGain.gain.value = 0.16;
    igniterFilter.connect(igniterGain).connect(master);
    this.igniterInput = igniterFilter;

    this.whoomphBuffer = createWhoomphBuffer(context);
    const whoomphFilter = context.createBiquadFilter();
    whoomphFilter.type = 'lowpass';
    whoomphFilter.frequency.value = 220;
    whoomphFilter.Q.value = 0.6;
    const whoomphGain = context.createGain();
    whoomphGain.gain.value = 0.22;
    whoomphFilter.connect(whoomphGain).connect(master);
    this.whoomphInput = whoomphFilter;

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

  /** A single oscillator routed through a tracking bandpass (starter "grind"). */
  private createFilteredTone(
    context: AudioContext,
    destination: AudioNode,
    type: OscillatorType,
    frequency: number,
    q: number,
  ): FilteredToneLayer {
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;
    gain.gain.value = 0;
    oscillator.connect(filter).connect(gain).connect(destination);
    oscillator.start();
    return { oscillator, filter, gain };
  }

  /** Two slightly detuned sawtooths through one narrow bandpass — VBV drone. */
  private createVbvDrone(context: AudioContext, destination: AudioNode): DualToneLayer {
    const oscA = context.createOscillator();
    const oscB = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscA.type = 'sawtooth';
    oscB.type = 'sawtooth';
    oscA.frequency.value = 320;
    oscB.frequency.value = 321.5;
    filter.type = 'bandpass';
    filter.frequency.value = 320;
    filter.Q.value = 5;
    gain.gain.value = 0;
    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain).connect(destination);
    oscA.start();
    oscB.start();
    return { oscA, oscB, filter, gain };
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
