/**
 * An original, generated soundtrack for the castle screen, in the spirit of a gothic reality-TV
 * score: low drone, choir-like pad, plucked arpeggios, a heartbeat at the Round Table and a
 * tolling bell for banishments. Everything is synthesised with Web Audio, so there are no audio
 * files and nothing copyrighted.
 */
export type Mood =
  'lobby' | 'mission' | 'table' | 'reveal' | 'night' | 'breakfast' | 'toll' | 'finale';

const D = 50; // MIDI: D3
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const MINOR = [0, 3, 7, 10, 12, 15, 19];

interface MoodSpec {
  step: number; // seconds per step
  root: number; // drone root (MIDI)
  chord: number[]; // pad voices as semitones above root
  pad: number; // pad level
}

const SPEC: Record<Mood, MoodSpec> = {
  lobby: { step: 0.62, root: D - 12, chord: [0, 7, 15], pad: 0.05 },
  mission: { step: 0.24, root: D - 12, chord: [0, 7, 12], pad: 0.035 },
  table: { step: 0.5, root: D - 11, chord: [0, 6, 13], pad: 0.05 }, // Eb under D: a minor-second sting
  reveal: { step: 1.0, root: D - 12, chord: [0, 7, 10], pad: 0.04 },
  night: { step: 2.2, root: D - 24, chord: [0, 7, 15], pad: 0.06 },
  breakfast: { step: 0.46, root: D - 12, chord: [0, 7, 16], pad: 0.04 },
  toll: { step: 1.6, root: D - 24, chord: [0, 6], pad: 0.05 },
  finale: { step: 0.7, root: D - 12, chord: [0, 7, 16, 19], pad: 0.07 },
};

export function moodFor(kind: string): Mood {
  switch (kind) {
    case 'lobby':
    case 'roleReveal':
      return 'lobby';
    case 'mission':
      return 'mission';
    case 'discussion':
    case 'voting':
    case 'endgameVote':
      return 'table';
    case 'voteReveal':
      return 'reveal';
    case 'night':
    case 'recruitOffer':
      return 'night';
    case 'breakfast':
      return 'breakfast';
    case 'speech':
      return 'toll';
    case 'finalReveal':
      return 'finale';
    default:
      return 'lobby';
  }
}

export class Soundtrack {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private wet!: GainNode;
  private padGain!: GainNode;
  private droneFilter!: BiquadFilterNode;
  private droneOscs: OscillatorNode[] = [];
  private padOscs: OscillatorNode[] = [];
  private timer: number | null = null;
  private mood: Mood = 'lobby';
  private next = 0;
  private stepNo = 0;
  private on = false;

  get playing(): boolean {
    return this.on;
  }

  start(): void {
    if (this.on) return;
    if (!this.ctx) this.build();
    const ctx = this.ctx;
    if (!ctx) return;
    void ctx.resume();
    this.on = true;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.8);
    this.next = ctx.currentTime + 0.1;
    this.applyMood(true);
    this.timer = window.setInterval(() => this.tick(), 100);
  }

  stop(): void {
    if (!this.on || !this.ctx) return;
    this.on = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  setMood(m: Mood): void {
    if (m === this.mood) return;
    this.mood = m;
    this.stepNo = 0;
    if (this.on) this.applyMood(false);
  }

  /** One-off sounds on top of the score. */
  stinger(kind: 'murder' | 'banish'): void {
    const ctx = this.ctx;
    if (!ctx || !this.on) return;
    const t = ctx.currentTime + 0.05;
    if (kind === 'murder') {
      this.thump(t, 0.9, 42);
      this.pluck(t, hz(D + 1), 2.5, 0.12);
      this.pluck(t, hz(D + 7), 2.5, 0.1);
    } else this.bell(t, hz(D - 12), 6, 0.35);
  }

  // ---- internals ----

  private build(): void {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // Cathedral-ish reverb from decaying noise.
    const len = Math.floor(ctx.sampleRate * 3.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const verb = ctx.createConvolver();
    verb.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.wet.connect(verb).connect(this.master);

    // Drone: two detuned saws through a slowly breathing low-pass.
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 220;
    this.droneFilter.Q.value = 4;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.16;
    this.droneFilter.connect(droneGain);
    droneGain.connect(this.master);
    droneGain.connect(this.wet);
    for (const detune of [-7, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = detune;
      o.connect(this.droneFilter);
      o.start();
      this.droneOscs.push(o);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(this.droneFilter.frequency);
    lfo.start();

    // Choir-like pad: soft triangles with slow vibrato.
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padGain.connect(this.master);
    this.padGain.connect(this.wet);
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.6;
    const vibGain = ctx.createGain();
    vibGain.gain.value = 5;
    vib.connect(vibGain);
    vib.start();
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      vibGain.connect(o.detune);
      o.connect(this.padGain);
      o.start();
      this.padOscs.push(o);
    }
  }

  private applyMood(immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const spec = SPEC[this.mood];
    const t = ctx.currentTime;
    const glide = immediate ? 0.05 : 1.4;
    const [d1, d2] = this.droneOscs;
    d1?.frequency.setTargetAtTime(hz(spec.root), t, glide);
    d2?.frequency.setTargetAtTime(hz(spec.root + 7), t, glide);
    this.padOscs.forEach((o, i) => {
      const semis = spec.chord[i % spec.chord.length] ?? 0;
      o.frequency.setTargetAtTime(hz(spec.root + 24 + semis), t, glide);
    });
    this.padGain.gain.setTargetAtTime(spec.pad, t, glide);
    this.droneFilter.frequency.setTargetAtTime(this.mood === 'night' ? 140 : 260, t, glide);
    if (this.mood === 'toll') this.bell(t + 0.1, hz(D - 12), 7, 0.38);
    if (this.mood === 'finale') this.bell(t + 0.1, hz(D), 8, 0.25);
    this.next = Math.max(this.next, t + 0.1);
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.on) return;
    const spec = SPEC[this.mood];
    while (this.next < ctx.currentTime + 0.35) {
      this.step(this.next, this.stepNo++);
      this.next += spec.step;
    }
  }

  private step(t: number, n: number): void {
    const note = (i: number, oct = 0) => hz(D + 12 + oct + (MINOR[i % MINOR.length] ?? 0));
    switch (this.mood) {
      case 'lobby': {
        const seq = [0, 2, 4, 2, 1, 3, 5, 3];
        this.pluck(t, note(seq[n % seq.length] ?? 0), 1.6, 0.1);
        if (n % 16 === 0) this.bell(t, note(0, 12), 5, 0.08);
        break;
      }
      case 'mission': {
        const seq = [0, 0, 2, 0, 1, 0, 3, 0];
        this.pluck(t, note(seq[n % seq.length] ?? 0, -12), 0.28, 0.12, 'sawtooth');
        break;
      }
      case 'table': {
        // lub-dub heartbeat, and a nervous high pluck now and then
        if (n % 4 === 0) this.thump(t, 0.5, 52);
        if (n % 4 === 1) this.thump(t, 0.32, 48);
        if (n % 8 === 5) this.pluck(t, hz(D + 25), 1.4, 0.06);
        break;
      }
      case 'reveal': {
        this.tick1(t);
        if (n % 4 === 0) this.thump(t, 0.3, 50);
        break;
      }
      case 'night': {
        if (Math.random() < 0.55) this.bell(t, note(Math.floor(Math.random() * 4), 12), 5, 0.05);
        if (n % 2 === 0) this.thump(t, 0.25, 40);
        break;
      }
      case 'breakfast': {
        const seq = [0, 2, 4, 6, 4, 2, 1, 3];
        this.pluck(t, note(seq[n % seq.length] ?? 0), 1.2, 0.09);
        break;
      }
      case 'toll': {
        if (n % 2 === 1) this.bell(t, hz(D - 12), 7, 0.3);
        break;
      }
      case 'finale': {
        const seq = [0, 2, 4, 6, 4, 2];
        this.pluck(t, note(seq[n % seq.length] ?? 0), 2, 0.1);
        if (n % 8 === 0) this.bell(t, note(0, 12), 6, 0.12);
        break;
      }
    }
  }

  private pluck(
    t: number,
    f: number,
    dur: number,
    level: number,
    type: OscillatorType = 'triangle',
  ) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(type === 'sawtooth' ? 900 : 2600, t);
    filt.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(filt).connect(g);
    g.connect(this.master);
    g.connect(this.wet);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  private bell(t: number, f: number, dur: number, level: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const parts: [number, number][] = [
      [1, 1],
      [2.0, 0.55],
      [2.76, 0.4],
      [5.4, 0.22],
      [8.93, 0.12],
    ];
    for (const [ratio, amp] of parts) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level * amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / Math.sqrt(ratio));
      o.connect(g);
      g.connect(this.master);
      g.connect(this.wet);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }

  private thump(t: number, level: number, f: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 2, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
  }

  private tick1(t: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.08);
  }
}
