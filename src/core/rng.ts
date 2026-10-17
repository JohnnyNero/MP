// Seeded RNG with named streams. Each stream's state lives in
// GameState.rng so a game is fully reproducible from its seed.

export type RngStream = 'board' | 'cards' | 'format' | 'bot' | 'house';

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function initRng(seed: number): Record<string, number> {
  const streams: RngStream[] = ['board', 'cards', 'format', 'bot', 'house'];
  const out: Record<string, number> = {};
  for (const s of streams) out[s] = (seed ^ hashString(s)) >>> 0;
  return out;
}

/** mulberry32 step: returns a float in [0, 1) and advances the stream. */
export function rand(rng: Record<string, number>, stream: RngStream): number {
  let t = (rng[stream] = (rng[stream] + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(rng: Record<string, number>, stream: RngStream, n: number): number {
  return Math.floor(rand(rng, stream) * n);
}

export function pick<T>(rng: Record<string, number>, stream: RngStream, arr: readonly T[]): T {
  return arr[randInt(rng, stream, arr.length)];
}

export function shuffle<T>(rng: Record<string, number>, stream: RngStream, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, stream, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Standalone generator for the real-time layer (cosmetics, minigame spawns). */
export function makeRandom(seed: number): () => number {
  const state = { s: seed >>> 0 };
  return () => rand(state as unknown as Record<string, number>, 's' as RngStream);
}
