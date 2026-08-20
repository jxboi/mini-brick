import { describe, expect, it } from 'vitest';

import {
  TOY_MODELS,
  createToyTargetDatasets,
  getToyModel,
  toyBlueprint,
  toyTargets,
  toyBuildPlan
} from '../src/toys/dataset.js';
import { brickCells, charAt, modelCells, planBuild, validateSolution } from '../src/toys/model.js';
import { CHAR_TO_COLOR, EMPTY_CHAR, quantize } from '../src/toys/palette.js';
import { COLORS } from '../src/brick.js';
import { GRID_SIZE, VOXEL_COUNT, indexToVoxel, voxelIndex } from '../src/rl/targets.js';
import { VoxelEnvironment } from '../src/rl/environment.js';

describe('toy dataset', () => {
  it('holds models generated from the toy photos', () => {
    expect(TOY_MODELS.length).toBeGreaterThan(50);
    for (const model of TOY_MODELS) {
      expect(model.id).toMatch(/^toy-\d{3}$/);
      expect(model.source).toMatch(/\.(webp|jpg|jpeg|png)$/);
      expect(model.layers).toHaveLength(model.size.height);
      for (const rows of model.layers) {
        expect(rows).toHaveLength(model.size.depth);
        for (const row of rows) expect(row).toHaveLength(model.size.width);
      }
    }
  });

  it('uses only palette characters that the app can render', () => {
    for (const model of TOY_MODELS) {
      for (const rows of model.layers) {
        for (const row of rows) {
          for (const char of row) {
            if (char === EMPTY_CHAR) continue;
            expect(CHAR_TO_COLOR[char]).toBeDefined();
            expect(COLORS[CHAR_TO_COLOR[char]]).toBeDefined();
          }
        }
      }
    }
  });

  it('counts every filled cell, supports included', () => {
    for (const model of TOY_MODELS) {
      expect(modelCells(model)).toHaveLength(model.voxelCount);
      expect(model.supportCount).toBeLessThanOrEqual(model.voxelCount);
    }
  });

  it('rests every cell on the baseplate or another cell', () => {
    for (const model of TOY_MODELS) {
      for (const cell of modelCells(model)) {
        if (cell.y === 0) continue;
        expect(charAt(model, cell.x, cell.y - 1, cell.z)).not.toBe(EMPTY_CHAR);
      }
    }
  });
});

describe('stored brick solutions', () => {
  it('build their model exactly, in a placeable order', () => {
    for (const model of TOY_MODELS) {
      const result = validateSolution(model);
      expect(result.errors).toEqual([]);
      expect(result.cellCount).toBe(model.voxelCount);
      expect(result.brickCount).toBe(model.brickCount);
    }
  });

  it('only use footprints the free builder offers', () => {
    const allowed = new Set(['1x1', '1x2', '1x3', '1x4', '2x2', '2x3', '2x4']);
    for (const model of TOY_MODELS) {
      for (const [, , , shape, rotation] of model.solution) {
        expect(allowed.has(shape)).toBe(true);
        expect([0, 1]).toContain(rotation);
        expect(brickCells(shape, rotation).length).toBeGreaterThan(0);
      }
    }
  });

  it('are what the planner regenerates from the layers', () => {
    const model = getToyModel(TOY_MODELS[0].id);
    expect(planBuild(model)).toEqual(model.solution);
  });

  it('flatten into blueprint entries like the duck', () => {
    const model = TOY_MODELS[0];
    const entries = toyBlueprint(model.id);
    expect(entries).toHaveLength(model.voxelCount);
    for (const entry of entries) {
      expect(COLORS[entry.color]).toBeDefined();
      expect(entry.y).toBeGreaterThanOrEqual(0);
    }
    // Layers arrive bottom-up, so a guided build never skips downward.
    const heights = entries.map((entry) => entry.y);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
  });

  it('exposes renderable bricks centered on the board', () => {
    const model = TOY_MODELS[0];
    const bricks = toyBuildPlan(model.id);
    expect(bricks).toHaveLength(model.brickCount);
    const limit = Math.max(model.size.width, model.size.depth);
    for (const brick of bricks) {
      expect(Math.abs(brick.x)).toBeLessThanOrEqual(limit);
      expect(Math.abs(brick.z)).toBeLessThanOrEqual(limit);
    }
  });
});

describe('4×4×4 agent targets', () => {
  it('are non-empty, supported skylines', () => {
    for (const target of toyTargets()) {
      expect(target.voxels).toHaveLength(VOXEL_COUNT);
      expect(target.count).toBeGreaterThan(0);
      for (let index = 0; index < VOXEL_COUNT; index++) {
        if (!target.voxels[index]) continue;
        const { x, y, z } = indexToVoxel(index);
        if (y === 0) continue;
        expect(target.voxels[voxelIndex(x, y - 1, z)]).toBe(1);
      }
    }
  });

  it('can be completed inside the environment step budget', () => {
    const environment = new VoxelEnvironment();
    for (const target of toyTargets().slice(0, 12)) {
      environment.reset(target);
      while (!environment.done) {
        const mask = environment.validActionMask();
        const action = mask.findIndex((valid, index) => valid && target.voxels[index]);
        expect(action).toBeGreaterThanOrEqual(0);
        environment.step(action);
      }
      expect(environment.correctCount).toBe(target.count);
    }
  });

  it('split into disjoint, difficulty-balanced datasets', () => {
    const datasets = createToyTargetDatasets();
    const splits = [datasets.train, datasets.validation, datasets.test];
    const hashes = splits.flat().map((target) => target.hash);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(datasets.train.length).toBeGreaterThan(datasets.test.length);
    for (const difficulty of ['easy', 'medium', 'hard']) {
      expect(datasets.trainByDifficulty[difficulty].length).toBeGreaterThan(0);
    }
  });
});

describe('palette quantization', () => {
  it('keeps neutral photo pixels neutral', () => {
    expect(quantize(255, 255, 255).char).toBe('W');
    expect(quantize(205, 205, 205).char).toBe('W');
    expect(quantize(35, 35, 38).char).toBe('K');
  });

  it('maps colored pixels to the nearest available hue', () => {
    expect(quantize(232, 60, 62).char).toBe('R');
    expect(quantize(252, 214, 70).char).toBe('Y');
    expect(quantize(95, 180, 235).char).toBe('B');
    expect(quantize(45, 105, 170).char).toBe('D');
  });

  it('never returns a color the brick materials do not know', () => {
    for (let r = 0; r < 256; r += 51) {
      for (let g = 0; g < 256; g += 51) {
        for (let b = 0; b < 256; b += 51) {
          expect(COLORS[quantize(r, g, b).color]).toBeDefined();
        }
      }
    }
  });
});

describe('grid conventions', () => {
  it('indexes agent targets the way the environment does', () => {
    expect(voxelIndex(1, 2, 3)).toBe(1 + GRID_SIZE * 3 + GRID_SIZE * GRID_SIZE * 2);
  });
});
