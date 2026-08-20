import { describe, expect, it } from 'vitest';
import { createQNetwork, epsilonAt, maskedArgMax, maskedMax } from '../src/rl/dqn.js';
import { curriculumDifficultyWeights } from '../src/rl/trainer.js';
import { ReplayBuffer } from '../src/rl/replay.js';
import { createRng } from '../src/rl/random.js';

describe('DQN utilities', () => {
  it('decays epsilon linearly and clamps it at the minimum', () => {
    expect(epsilonAt(0)).toBe(1);
    expect(epsilonAt(6000)).toBeCloseTo(0.525);
    expect(epsilonAt(12000)).toBeCloseTo(0.05);
    expect(epsilonAt(24000)).toBeCloseTo(0.05);
  });

  it('moves from easy targets to a mixed hard-target curriculum', () => {
    expect(curriculumDifficultyWeights(0.1)).toEqual({ easy: 1, medium: 0, hard: 0 });
    expect(curriculumDifficultyWeights(0.3)).toEqual({ easy: 0.1, medium: 0.9, hard: 0 });
    expect(curriculumDifficultyWeights(0.6)).toEqual({ easy: 0, medium: 0.15, hard: 0.85 });
    expect(curriculumDifficultyWeights(0.9)).toEqual({ easy: 0.1, medium: 0.2, hard: 0.7 });
  });

  it('selects and bootstraps only from unmasked actions', () => {
    const values = Float32Array.from([100, 3, 8, -2]);
    const mask = Uint8Array.from([0, 1, 1, 0]);
    expect(maskedArgMax(values, mask)).toBe(2);
    expect(maskedMax(values, mask)).toBe(8);
    expect(maskedArgMax(values, new Uint8Array(4))).toBe(-1);
    expect(maskedMax(values, new Uint8Array(4))).toBe(0);
  });

  it('scores all 64 voxel actions through global and shared local branches', () => {
    const model = createQNetwork(7);
    expect(model.inputs[0].shape).toEqual([null, 64, 2]);
    expect(model.outputs[0].shape).toEqual([null, 64]);
    model.dispose();
  });

  it('keeps replay memory bounded and samples deterministically', () => {
    const replay = new ReplayBuffer(3);
    for (let value = 0; value < 5; value++) replay.push({ value });
    expect(replay.length).toBe(3);
    const one = replay.sample(5 > replay.length ? replay.length : 5, createRng('sample'));
    const two = replay.sample(3, createRng('sample'));
    expect(one).toEqual(two);
    expect(one.every((item) => item.value >= 2)).toBe(true);
  });
});
