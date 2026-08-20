/**
 * Accessors for the voxelized toy dataset.
 *
 * `models.data.js` is generated from the photos in `assets/toys/` by
 * `scripts/voxelize-toys.js`. This module turns those records into the two
 * shapes the rest of the app already understands:
 *
 *   - `toyBlueprint(id)` → the same `{ x, y, z, color }` entries as
 *     `DUCK_BLUEPRINT`, ordered by a build plan that never places a brick on
 *     thin air, so `Builder` can walk a toy the way it walks the duck.
 *   - `createToyTargetDatasets()` → train/validation/test splits shaped exactly
 *     like `createTargetDatasets()` in `src/rl/targets.js`, so the 4×4×4
 *     targets can be fed straight to `trainDQN({ datasets })`.
 */

import { TOY_DATASET } from './models.data.js';
import { toBlueprint, solutionBricks, validateSolution, modelCells } from './model.js';
import { DIFFICULTY_NAMES } from '../rl/targets.js';

export const TOY_MODELS = TOY_DATASET.models;
export const TOY_GRID = TOY_DATASET.grid;

const BY_ID = new Map(TOY_MODELS.map((model) => [model.id, model]));

/** One toy model record, by id (`toy-001`) or by source file (`001.webp`). */
export function getToyModel(id) {
  const model = BY_ID.get(id) ?? TOY_MODELS.find((entry) => entry.source === id);
  if (!model) throw new Error(`Unknown toy model: ${id}`);
  return model;
}

/** Blueprint entries for a toy, in build order — a drop-in for `DUCK_BLUEPRINT`. */
export function toyBlueprint(id) {
  return toBlueprint(getToyModel(id));
}

/** The stored solution as renderable bricks: centered coords, color, footprint. */
export function toyBuildPlan(id) {
  const model = getToyModel(id);
  return solutionBricks(model);
}

/** Re-checks a stored solution against its model. */
export function checkToyModel(id) {
  const model = getToyModel(id);
  return validateSolution(model);
}

/** Every filled cell of a toy, in build order, with grid coordinates. */
export function toyCells(id) {
  return modelCells(getToyModel(id));
}

/** A toy's 4×4×4 DQN target in the shape `VoxelEnvironment.reset()` expects. */
export function toyTarget(model, split = 'toy') {
  return {
    id: model.id,
    split,
    source: model.source,
    difficulty: model.target4.difficulty,
    count: model.target4.count,
    hash: model.target4.hash,
    voxels: Uint8Array.from(model.target4.voxels)
  };
}

/**
 * Every toy target, deduplicated by voxel hash. Coarse 4×4×4 grids collapse
 * some distinct toys onto the same skyline; keeping both copies would leak a
 * training structure into an evaluation split.
 */
export function toyTargets() {
  const seen = new Set();
  const targets = [];
  for (const model of TOY_MODELS) {
    if (seen.has(model.target4.hash)) continue;
    seen.add(model.target4.hash);
    targets.push(toyTarget(model));
  }
  return targets;
}

function byDifficulty(targets) {
  return Object.fromEntries(
    DIFFICULTY_NAMES.map((difficulty) => [
      difficulty,
      targets.filter((target) => target.difficulty === difficulty)
    ])
  );
}

/**
 * Splits the toy targets into train / validation / test, shaped like
 * `createTargetDatasets()`.
 *
 * The split is deterministic and stratified: within each difficulty tier the
 * targets are dealt out in id order — roughly two thirds train, a sixth
 * validation, a sixth unseen — so every tier is represented in every split and
 * no voxel hash crosses between them. Note that these are only ~80 structures
 * against the synthetic generator's 512: useful as a held-out transfer set or a
 * fine-tuning pool, not as a replacement training corpus.
 */
export function createToyTargetDatasets({ validationEvery = 6, testEvery = 3 } = {}) {
  const train = [];
  const validation = [];
  const test = [];

  for (const difficulty of DIFFICULTY_NAMES) {
    const pool = toyTargets()
      .filter((target) => target.difficulty === difficulty)
      .sort((a, b) => a.id.localeCompare(b.id));
    pool.forEach((target, index) => {
      if (index % validationEvery === validationEvery - 1) validation.push({ ...target, split: 'validation' });
      else if (index % testEvery === testEvery - 1) test.push({ ...target, split: 'unseen' });
      else train.push({ ...target, split: 'train' });
    });
  }

  return {
    train,
    validation,
    test,
    trainByDifficulty: byDifficulty(train),
    validationByDifficulty: byDifficulty(validation),
    testByDifficulty: byDifficulty(test)
  };
}

export { TOY_DATASET };
