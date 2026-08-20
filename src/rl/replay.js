import { sampleIndex } from './random.js';

export class ReplayBuffer {
  constructor(capacity = 20000) {
    this.capacity = capacity;
    this.items = new Array(capacity);
    this.length = 0;
    this.cursor = 0;
  }

  push(transition) {
    this.items[this.cursor] = transition;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.length = Math.min(this.length + 1, this.capacity);
  }

  sample(size, rng = Math.random) {
    if (size > this.length) throw new Error('Cannot sample more transitions than the buffer contains.');
    const sample = [];
    for (let i = 0; i < size; i++) sample.push(this.items[sampleIndex(rng, this.length)]);
    return sample;
  }

  clear() {
    this.items = new Array(this.capacity);
    this.length = 0;
    this.cursor = 0;
  }
}
