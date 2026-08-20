import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  BLUEPRINTS,
  DEFAULT_BLUEPRINT_ID,
  blueprintGroups,
  getBlueprint
} from '../src/blueprints.js';
import { Builder, autoIntervalFor } from '../src/builder.js';
import { DUCK_BLUEPRINT, DUCK_MODEL, TOTAL_BRICKS } from '../src/blueprint.js';
import { TOY_MODELS } from '../src/toys/dataset.js';
import { brickCells, modelCells, planBuild } from '../src/toys/model.js';
import { COLORS } from '../src/brick.js';

/** Every 1x1 cell a plan's bricks cover, as "x,y,z" keys. */
function cellKeys(bricks) {
  const keys = [];
  for (const brick of bricks) {
    for (const { dx, dz } of brick.cells) keys.push(`${brick.x + dx},${brick.y},${brick.z + dz}`);
  }
  return keys;
}

describe('blueprint catalog', () => {
  it('lists the duck plus every toy, duck first', () => {
    expect(BLUEPRINTS).toHaveLength(TOY_MODELS.length + 1);
    expect(BLUEPRINTS[0].id).toBe(DEFAULT_BLUEPRINT_ID);
    expect(new Set(BLUEPRINTS.map((entry) => entry.id)).size).toBe(BLUEPRINTS.length);
  });

  it('gives every entry the metadata the picker renders', () => {
    for (const entry of BLUEPRINTS) {
      expect(entry.name).toBeTruthy();
      expect(entry.size.width).toBeGreaterThan(0);
      expect(entry.size.height).toBeGreaterThan(0);
      expect(entry.size.depth).toBeGreaterThan(0);
      expect(entry.brickCount).toBeGreaterThan(0);
      expect(entry.cellCount).toBeGreaterThan(0);
    }
  });

  it('resolves a bundled photo for every toy and none for the duck', () => {
    expect(getBlueprint('duck').thumbnail).toBeNull();
    for (const entry of BLUEPRINTS.slice(1)) {
      expect(typeof entry.thumbnail).toBe('string');
      expect(entry.thumbnail.length).toBeGreaterThan(0);
    }
  });

  it('groups the toys by difficulty behind the duck', () => {
    const groups = blueprintGroups();
    expect(groups[0][0]).toBe('Classic');
    expect(groups.map(([name]) => name)).toEqual(['Classic', 'easy', 'medium', 'hard']);
    expect(groups.flatMap(([, entries]) => entries)).toHaveLength(BLUEPRINTS.length);
  });

  it('falls back to the duck for an unknown id', () => {
    expect(getBlueprint('nope').id).toBe('duck');
  });

  it('caches a loaded plan instead of decoding it twice', () => {
    const entry = getBlueprint('toy-004');
    expect(entry.load()).toBe(entry.load());
  });
});

describe('blueprint plans', () => {
  const sample = ['duck', 'toy-001', 'toy-030', 'toy-060', 'toy-089'].map(getBlueprint);

  it('covers each model exactly once, in a placeable order', () => {
    for (const entry of sample) {
      const { bricks } = entry.load();
      expect(bricks).toHaveLength(entry.brickCount);

      const keys = cellKeys(bricks);
      expect(keys).toHaveLength(entry.cellCount);
      expect(new Set(keys).size).toBe(entry.cellCount);

      // Bottom-up: a brick never sits below one placed before it.
      let previousY = 0;
      for (const brick of bricks) {
        expect(brick.y).toBeGreaterThanOrEqual(previousY);
        previousY = brick.y;
        expect(COLORS[brick.color]).toBeDefined();
      }
      expect(bricks[0].y).toBe(0);
    }
  });

  it('snaps every model onto the baseplate stud grid', () => {
    for (const entry of BLUEPRINTS) {
      const { bricks } = entry.load();
      for (const brick of bricks) {
        expect(Number.isInteger(brick.x)).toBe(true);
        expect(Number.isInteger(brick.y)).toBe(true);
        expect(Number.isInteger(brick.z)).toBe(true);
      }
    }
  });

  it('keeps each model centered on the baseplate', () => {
    for (const entry of sample) {
      const xs = cellKeys(entry.load().bricks).map((key) => Number(key.split(',')[0]));
      const centre = (Math.min(...xs) + Math.max(...xs)) / 2;
      expect(Math.abs(centre)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('duck model', () => {
  it('re-expresses the authored duck on a uniform grid without losing a cell', () => {
    const cells = modelCells(DUCK_MODEL);
    expect(cells).toHaveLength(TOTAL_BRICKS);

    const leftX = -(DUCK_MODEL.size.width - 1) / 2;
    const frontZ = (DUCK_MODEL.size.depth - 1) / 2;
    const authored = new Set(
      DUCK_BLUEPRINT.map((entry) => `${entry.x},${entry.y},${entry.z},${entry.color}`)
    );
    for (const cell of cells) {
      expect(authored.has(`${leftX + cell.x},${cell.y},${cell.z - frontZ},${cell.color}`)).toBe(true);
    }
  });

  it('tiles into bricks that cover every authored cell exactly once', () => {
    const plan = planBuild(DUCK_MODEL);
    const keys = cellKeys(
      plan.map(([x, y, z, shape, rotation, char]) => ({
        x,
        y,
        z,
        color: char,
        cells: brickCells(shape, rotation)
      }))
    );
    expect(keys).toHaveLength(TOTAL_BRICKS);
    expect(new Set(keys).size).toBe(TOTAL_BRICKS);
    expect(plan.length).toBe(getBlueprint('duck').brickCount);
  });
});

describe('Builder blueprint switching', () => {
  it('starts on the duck', () => {
    const builder = new Builder(new THREE.Scene());
    const state = builder.getState();
    expect(state.blueprintId).toBe('duck');
    expect(state.total).toBe(getBlueprint('duck').brickCount);
    expect(state.placed).toBe(0);
  });

  it('swaps the plan, the preview and the board without orphaning scene nodes', () => {
    const scene = new THREE.Scene();
    const builder = new Builder(scene);
    const sceneChildren = scene.children.length;

    builder.placeNext();
    builder.placeNext();
    expect(builder.getState().placed).toBe(2);

    const toy = getBlueprint('toy-012');
    builder.setBlueprint(toy);

    expect(builder.getState().blueprintId).toBe('toy-012');
    expect(builder.getState().total).toBe(toy.brickCount);
    expect(builder.getState().placed).toBe(0);
    expect(builder.placedMeshes).toHaveLength(0);
    expect(builder.placedGroup.children).toHaveLength(0);
    expect(builder.previewGroup.children).toHaveLength(toy.brickCount);
    expect(scene.children.length).toBe(sceneChildren);
  });

  it('keeps the preview on shared geometry and materials across swaps', () => {
    const builder = new Builder(new THREE.Scene());
    for (const id of ['toy-003', 'toy-044', 'duck', 'toy-077']) {
      builder.setBlueprint(getBlueprint(id));
    }
    const materials = new Set(builder.previewGroup.children.map((mesh) => mesh.material));
    const geometries = new Set(builder.previewGroup.children.map((mesh) => mesh.geometry));
    expect(materials.size).toBeLessThanOrEqual(Object.keys(COLORS).length);
    // One geometry per distinct footprint, not one per brick.
    expect(geometries.size).toBeLessThanOrEqual(14);
  });

  it('builds a toy to completion in exactly its brick count', () => {
    const builder = new Builder(new THREE.Scene());
    const toy = getBlueprint('toy-020');
    builder.setBlueprint(toy);

    let steps = 0;
    while (builder.placeNext()) steps++;

    expect(steps).toBe(toy.brickCount);
    expect(builder.getState().done).toBe(true);
    expect(builder.getState().cells).toBe(toy.cellCount);
  });

  it('undoes a placement', () => {
    const builder = new Builder(new THREE.Scene());
    builder.placeNext();
    builder.placeNext();
    expect(builder.undo()).toBe(true);
    expect(builder.getState().placed).toBe(1);
    expect(builder.placedMeshes).toHaveLength(1);
  });

  it('paces auto-build so a large model does not take minutes', () => {
    expect(autoIntervalFor(1)).toBe(0.16);
    expect(autoIntervalFor(453)).toBeLessThan(0.05);
    expect(autoIntervalFor(100000)).toBe(0.02);
    for (const entry of BLUEPRINTS) {
      const seconds = entry.brickCount * autoIntervalFor(entry.brickCount);
      expect(seconds).toBeLessThanOrEqual(16);
    }
  });
});
