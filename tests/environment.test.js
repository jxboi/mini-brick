import { describe, expect, it } from 'vitest';
import { VoxelEnvironment } from '../src/rl/environment.js';
import { VOXEL_COUNT, voxelIndex } from '../src/rl/targets.js';

function targetAt(indices) {
  const voxels = new Uint8Array(VOXEL_COUNT);
  for (const index of indices) voxels[index] = 1;
  return { voxels, count: indices.length };
}

describe('VoxelEnvironment', () => {
  it('returns the target and current occupancy as a 128-value observation', () => {
    const environment = new VoxelEnvironment();
    const observation = environment.reset(targetAt([0, 1]));
    expect(observation).toHaveLength(128);
    expect(Array.from(observation.slice(0, 4))).toEqual([1, 1, 0, 0]);
    expect(Array.from(observation.slice(64))).toEqual(new Array(64).fill(0));
  });

  it('masks occupied and unsupported cells without consulting the target', () => {
    const environment = new VoxelEnvironment();
    environment.reset(targetAt([voxelIndex(0, 0, 0), voxelIndex(0, 1, 0)]));
    const initialMask = environment.validActionMask();
    expect(initialMask.slice(0, 16).every((value) => value === 1)).toBe(true);
    expect(initialMask[voxelIndex(0, 1, 0)]).toBe(0);

    environment.step(voxelIndex(0, 0, 0));
    const nextMask = environment.validActionMask();
    expect(nextMask[voxelIndex(0, 0, 0)]).toBe(0);
    expect(nextMask[voxelIndex(0, 1, 0)]).toBe(1);
  });

  it('rewards correct placements and ends with the completion bonus', () => {
    const environment = new VoxelEnvironment();
    environment.reset(targetAt([voxelIndex(0, 0, 0), voxelIndex(0, 1, 0)]));
    const first = environment.step(voxelIndex(0, 0, 0));
    const second = environment.step(voxelIndex(0, 1, 0));
    expect(first.reward).toBeCloseTo(0.99);
    expect(first.done).toBe(false);
    expect(second.reward).toBeCloseTo(5.99);
    expect(second.done).toBe(true);
    expect(second.info.success).toBe(true);
    expect(second.info.coverage).toBe(1);
  });

  it('terminates on a supported off-target placement', () => {
    const environment = new VoxelEnvironment();
    environment.reset(targetAt([voxelIndex(0, 0, 0)]));
    const result = environment.step(voxelIndex(1, 0, 0));
    expect(result.reward).toBeCloseTo(-2.01);
    expect(result.done).toBe(true);
    expect(result.info.reason).toBe('off-target');
    expect(result.info.success).toBe(false);
  });

  it('penalizes an unsupported direct action without changing occupancy', () => {
    const environment = new VoxelEnvironment();
    environment.reset(targetAt([voxelIndex(0, 0, 0), voxelIndex(0, 1, 0)]));
    const result = environment.step(voxelIndex(0, 1, 0));
    expect(result.reward).toBeCloseTo(-0.26);
    expect(result.done).toBe(false);
    expect(result.info.placedCount).toBe(0);
  });
});
