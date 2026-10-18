// Tiny synthesized sound effects (no audio assets).

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  // Browsers block audio until the page has had a user gesture.
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (!ctx && ua && !ua.hasBeenActive) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.06, slide = 0) {
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.linearRampToValueAtTime(freq + slide, a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}

export type SfxName = 'hit' | 'coin' | 'pickup' | 'boom' | 'blip' | 'step' | 'roll' | 'select' | 'win' | 'bad' | 'whoosh';

export function sfx(name: SfxName) {
  switch (name) {
    case 'hit':
      return tone(180, 0.15, 'sawtooth', 0.06, -120);
    case 'coin':
      tone(880, 0.06, 'square', 0.04);
      return setTimeout(() => tone(1320, 0.08, 'square', 0.04), 60);
    case 'pickup':
      return tone(660, 0.08, 'triangle', 0.08, 400);
    case 'boom':
      return tone(90, 0.35, 'sawtooth', 0.08, -60);
    case 'blip':
      return tone(520, 0.05, 'square', 0.04);
    case 'step':
      return tone(300, 0.03, 'triangle', 0.05);
    case 'roll':
      return tone(400 + Math.random() * 300, 0.03, 'square', 0.03);
    case 'select':
      return tone(740, 0.07, 'triangle', 0.07, 200);
    case 'win':
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.08), i * 140));
      return;
    case 'whoosh':
      tone(1100, 0.22, 'sawtooth', 0.025, -800);
      tone(420, 0.18, 'triangle', 0.06, -260);
      return setTimeout(() => tone(660, 0.07, 'square', 0.035, 240), 150);
    case 'bad':
      [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'sawtooth', 0.05), i * 180));
      return;
  }
}
