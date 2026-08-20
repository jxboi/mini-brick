import { createRng, randomInt, sampleIndex } from './random.js';

export const GRID_SIZE = 4;
export const VOXEL_COUNT = GRID_SIZE ** 3;
export const DEFAULT_EXPERIMENT_SEED = 'mini-brick-dqn-v2';

export const TARGET_DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ minExtras: 2, maxExtras: 4 }),
  medium: Object.freeze({ minExtras: 5, maxExtras: 10 }),
  hard: Object.freeze({ minExtras: 11, maxExtras: 16 })
});

export const DIFFICULTY_NAMES = Object.freeze(Object.keys(TARGET_DIFFICULTIES));

export function voxelIndex(x, y, z) {
  return x + GRID_SIZE * z + GRID_SIZE * GRID_SIZE * y;
}

export function indexToVoxel(index) {
  const y = Math.floor(index / (GRID_SIZE * GRID_SIZE));
  const withinLayer = index % (GRID_SIZE * GRID_SIZE);
  const z = Math.floor(withinLayer / GRID_SIZE);
  const x = withinLayer % GRID_SIZE;
  return { x, y, z };
}

export function hashVoxels(voxels) {
  let result = '';
  for (let offset = 0; offset < VOXEL_COUNT; offset += 4) {
    let nibble = 0;
    for (let bit = 0; bit < 4; bit++) {
      if (voxels[offset + bit]) nibble |= 1 << bit;
    }
    result += nibble.toString(16);
  }
  return result;
}

/**
 * Generates a supported miniature skyline. Every target has a connected 4×4
 * foundation plus a difficulty-dependent number of tower voxels. Repeated
 * column selections create taller towers while preserving physical support.
 */
export function generateTarget(rng, difficulty = 'easy') {
  const range = TARGET_DIFFICULTIES[difficulty];
  if (!range) throw new Error(`Unknown target difficulty: ${difficulty}`);

  const heights = new Uint8Array(GRID_SIZE * GRID_SIZE);
  heights.fill(1);
  const extraCount = randomInt(rng, range.minExtras, range.maxExtras);
  for (let extra = 0; extra < extraCount; extra++) {
    const candidates = [];
    for (let column = 0; column < heights.length; column++) {
      if (heights[column] < GRID_SIZE) candidates.push(column);
    }
    heights[candidates[sampleIndex(rng, candidates.length)]]++;
  }

  const voxels = new Uint8Array(VOXEL_COUNT);
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const height = heights[x + GRID_SIZE * z];
      for (let y = 0; y < height; y++) voxels[voxelIndex(x, y, z)] = 1;
    }
  }
  const count = GRID_SIZE * GRID_SIZE + extraCount;
  return { voxels, count, extraCount, difficulty, hash: hashVoxels(voxels) };
}

function makeSplit(rng, split, count, usedHashes) {
  const targets = [];
  while (targets.length < count) {
    const difficulty = DIFFICULTY_NAMES[targets.length % DIFFICULTY_NAMES.length];
    const target = generateTarget(rng, difficulty);
    if (usedHashes.has(target.hash)) continue;
    usedHashes.add(target.hash);
    targets.push({
      ...target,
      id: `${split}-${String(targets.length + 1).padStart(3, '0')}`,
      split
    });
  }
  return targets;
}

export function createTargetDatasets(seed = DEFAULT_EXPERIMENT_SEED) {
  const rng = createRng(seed);
  const hashes = new Set();
  const train = makeSplit(rng, 'train', 512, hashes);
  const validation = makeSplit(rng, 'validation', 64, hashes);
  const test = makeSplit(rng, 'unseen', 100, hashes);
  const byDifficulty = (targets) => Object.fromEntries(
    DIFFICULTY_NAMES.map((difficulty) => [
      difficulty,
      targets.filter((target) => target.difficulty === difficulty)
    ])
  );
  return {
    train,
    validation,
    test,
    trainByDifficulty: byDifficulty(train),
    validationByDifficulty: byDifficulty(validation),
    testByDifficulty: byDifficulty(test)
  };
}

export function serializeTarget(target) {
  return {
    id: target.id,
    split: target.split,
    count: target.count,
    extraCount: target.extraCount,
    difficulty: target.difficulty,
    hash: target.hash,
    voxels: Array.from(target.voxels)
  };
}
