import { describe, expect, it } from 'vitest';
import {
  GRID_SIZE,
  TARGET_DIFFICULTIES,
  createTargetDatasets,
  indexToVoxel,
  voxelIndex
} from '../src/rl/targets.js';

function isConnectedBase(voxels) {
  const base = [];
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (voxels[voxelIndex(x, 0, z)]) base.push({ x, z });
    }
  }
  const seen = new Set([`${base[0].x},${base[0].z}`]);
  const queue = [base[0]];
  while (queue.length) {
    const current = queue.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${current.x + dx},${current.z + dz}`;
      if (!seen.has(key) && base.some((cell) => `${cell.x},${cell.z}` === key)) {
        seen.add(key);
        queue.push({ x: current.x + dx, z: current.z + dz });
      }
    }
  }
  return seen.size === base.length;
}

describe('target datasets', () => {
  it('is deterministic and creates the requested disjoint splits', () => {
    const first = createTargetDatasets('test-seed');
    const second = createTargetDatasets('test-seed');
    expect(first.train).toHaveLength(512);
    expect(first.validation).toHaveLength(64);
    expect(first.test).toHaveLength(100);
    expect(first.test.map((target) => target.hash)).toEqual(second.test.map((target) => target.hash));
    const hashes = [...first.train, ...first.validation, ...first.test].map((target) => target.hash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('creates supported 18–32 voxel structures across all difficulty tiers', () => {
    const datasets = createTargetDatasets('shape-check');
    expect(Object.keys(datasets.testByDifficulty)).toEqual(['easy', 'medium', 'hard']);
    expect(datasets.testByDifficulty.easy).toHaveLength(34);
    expect(datasets.testByDifficulty.medium).toHaveLength(33);
    expect(datasets.testByDifficulty.hard).toHaveLength(33);

    for (const target of [...datasets.train, ...datasets.validation, ...datasets.test]) {
      const range = TARGET_DIFFICULTIES[target.difficulty];
      expect(target.extraCount).toBeGreaterThanOrEqual(range.minExtras);
      expect(target.extraCount).toBeLessThanOrEqual(range.maxExtras);
      expect(target.count).toBe(16 + target.extraCount);
      expect(isConnectedBase(target.voxels)).toBe(true);
      for (let index = 0; index < target.voxels.length; index++) {
        if (!target.voxels[index]) continue;
        const { x, y, z } = indexToVoxel(index);
        if (y > 0) expect(target.voxels[voxelIndex(x, y - 1, z)]).toBe(1);
      }
    }
  });
});
