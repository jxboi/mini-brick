import { GRID_SIZE, VOXEL_COUNT, indexToVoxel, voxelIndex } from './targets.js';

const STEP_COST = 0.01;

/** Renderer-independent discrete voxel construction environment. */
export class VoxelEnvironment {
  constructor() {
    this.target = new Uint8Array(VOXEL_COUNT);
    this.current = new Uint8Array(VOXEL_COUNT);
    this.targetCount = 0;
    this.correctCount = 0;
    this.placedCount = 0;
    this.steps = 0;
    this.maxSteps = 0;
    this.done = true;
  }

  reset(target) {
    const source = target?.voxels ?? target;
    if (!source || source.length !== VOXEL_COUNT) {
      throw new Error(`Target must contain exactly ${VOXEL_COUNT} voxels.`);
    }
    this.target = Uint8Array.from(source);
    this.current.fill(0);
    this.targetCount = target?.count ?? this.target.reduce((sum, value) => sum + value, 0);
    this.correctCount = 0;
    this.placedCount = 0;
    this.steps = 0;
    this.maxSteps = Math.max(1, this.targetCount * 2);
    this.done = false;
    return this.observation();
  }

  observation() {
    const observation = new Float32Array(VOXEL_COUNT * 2);
    observation.set(this.target, 0);
    observation.set(this.current, VOXEL_COUNT);
    return observation;
  }

  validActionMask() {
    const mask = new Uint8Array(VOXEL_COUNT);
    if (this.done) return mask;

    for (let action = 0; action < VOXEL_COUNT; action++) {
      if (this.current[action]) continue;
      const { x, y, z } = indexToVoxel(action);
      if (y === 0 || this.current[voxelIndex(x, y - 1, z)]) mask[action] = 1;
    }
    return mask;
  }

  step(action) {
    if (this.done) throw new Error('Cannot step a completed episode. Call reset() first.');

    this.steps++;
    const valid = Number.isInteger(action) && action >= 0 && action < VOXEL_COUNT &&
      this.validActionMask()[action] === 1;

    let reward;
    let reason = 'building';
    let success = false;
    let placed = false;

    if (!valid) {
      reward = -0.25 - STEP_COST;
      reason = 'invalid';
    } else {
      placed = true;
      this.current[action] = 1;
      this.placedCount++;

      if (this.target[action]) {
        this.correctCount++;
        reward = 1 - STEP_COST;
        if (this.correctCount === this.targetCount) {
          reward += 5;
          reason = 'complete';
          success = true;
          this.done = true;
        }
      } else {
        reward = -2 - STEP_COST;
        reason = 'off-target';
        this.done = true;
      }
    }

    if (!this.done && this.steps >= this.maxSteps) {
      this.done = true;
      reason = 'step-limit';
    }

    return {
      observation: this.observation(),
      reward,
      done: this.done,
      info: this.info({ reason, success, placed, action })
    };
  }

  info(extra = {}) {
    return {
      ...extra,
      correctCount: this.correctCount,
      targetCount: this.targetCount,
      placedCount: this.placedCount,
      steps: this.steps,
      coverage: this.targetCount ? this.correctCount / this.targetCount : 1,
      precision: this.placedCount ? this.correctCount / this.placedCount : 1
    };
  }
}

export { GRID_SIZE, VOXEL_COUNT };
