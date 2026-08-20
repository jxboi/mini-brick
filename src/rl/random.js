/** Deterministic string-to-uint32 hash used to seed every experiment. */
export function hashSeed(value) {
  const text = String(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Small, fast deterministic pseudo-random number generator. */
export function createRng(seed = 'mini-brick-dqn-v2') {
  let state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng, min, maxInclusive) {
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}

export function sampleIndex(rng, length) {
  return Math.floor(rng() * length);
}
