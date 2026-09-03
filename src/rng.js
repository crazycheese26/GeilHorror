// A small seeded generator, so a ship can be reproduced from a short code.
//
// Only the *layout* is seeded — where the pakjes lie, where Mr. Geil starts,
// the circuit he walks, which lanterns are dead. Runtime jitter (flicker,
// footstep timing, his look-around pauses) stays on Math.random, because two
// runs of the same ship should still feel different once you are in it.

// mulberry32: 32 bits of state, no dependencies, good enough for placement.
export class Rng {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.state = (this.seed || 0x9e3779b9) >>> 0;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + this.next() * (max - min);
  }

  int(n) {
    return Math.floor(this.next() * n);
  }

  pick(list) {
    return list[this.int(list.length)];
  }

  chance(p) {
    return this.next() < p;
  }

  // Fisher-Yates on a copy: the caller's array is never touched.
  shuffle(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  // Weighted draw. `weightOf` must return a non-negative number; an all-zero
  // set falls back to a uniform pick rather than returning nothing.
  pickWeighted(list, weightOf) {
    let total = 0;
    for (const item of list) total += Math.max(0, weightOf(item));
    if (total <= 0) return this.pick(list);

    let roll = this.next() * total;
    for (const item of list) {
      roll -= Math.max(0, weightOf(item));
      if (roll <= 0) return item;
    }
    return list[list.length - 1];
  }
}

export function makeSeed() {
  return (Math.random() * 0x100000000) >>> 0;
}

// Base 36 keeps a 32-bit seed down to seven readable characters.
export function formatSeed(seed) {
  return (seed >>> 0).toString(36).toUpperCase();
}

// Anything typable becomes a seed: "STOOMBOOT" is as valid as "3K7QW1".
// Returns null for empty or unparseable input, which means "roll a new one".
export function parseSeed(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.trim().replace(/[^0-9a-z]/gi, '');
  if (!cleaned) return null;

  // Long words overflow a 32-bit int, so fold them instead of truncating.
  let hash = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const digit = parseInt(cleaned[i], 36);
    hash = (Math.imul(hash, 36) + digit) >>> 0;
  }
  return hash;
}
