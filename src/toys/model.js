/**
 * Toy voxel models: decoding, build planning, and validation.
 *
 * A model is stored the same way `src/blueprint.js` authors the duck — as
 * stacked ASCII layers, bottom (y = 0) first. Within a layer, rows run FRONT
 * (nearest the camera, largest z) to BACK and columns run LEFT (smallest x) to
 * RIGHT, so `layers[y][row][col]` addresses one cell. Grid coordinates here are
 * integers in `[0, size)`; `toBlueprint()` re-centers them on x/z the way the
 * duck blueprint does.
 *
 * This module is renderer-independent: the voxelizer script, the tests, and the
 * app all share it.
 */

import { CHAR_TO_COLOR, EMPTY_CHAR } from './palette.js';

/**
 * Rectangular footprints a build plan may use, in descending area order — the
 * same list `Builder` auto-build tries, expressed as `[w, d]` in cells.
 */
export const FOOTPRINTS = Object.freeze([
  [4, 2], [2, 4], // area 8
  [3, 2], [2, 3], // area 6
  [4, 1], [1, 4], [2, 2], // area 4
  [3, 1], [1, 3], // area 3
  [2, 1], [1, 2], // area 2
  [1, 1] // area 1
].map((pair) => Object.freeze(pair)));

/** Shape id + rotation step for a `w × d` footprint, or null if unsupported. */
export function footprintToShape(w, d) {
  if (d === 1) return { shape: `1x${w}`, rotation: 0 };
  if (w === 1) return { shape: `1x${d}`, rotation: 1 };
  if (d === 2) return { shape: `2x${w}`, rotation: 0 };
  if (w === 2) return { shape: `2x${d}`, rotation: 1 };
  return null;
}

/** Cell offsets `{ dx, dz }` covered by a shape id at a rotation step. */
export function brickCells(shape, rotation = 0) {
  const [a, b] = shape.split('x').map(Number);
  const w = rotation % 2 === 0 ? b : a;
  const d = rotation % 2 === 0 ? a : b;
  const cells = [];
  for (let dz = 0; dz < d; dz++) {
    for (let dx = 0; dx < w; dx++) cells.push({ dx, dz });
  }
  return cells;
}

/** Flat index of a grid cell inside a model of the given size. */
export function cellIndex(size, x, y, z) {
  return x + size.width * z + size.width * size.depth * y;
}

/** Character stored at a grid cell, or `EMPTY_CHAR` when the cell is empty. */
export function charAt(model, x, y, z) {
  const { width, height, depth } = model.size;
  if (x < 0 || y < 0 || z < 0 || x >= width || y >= height || z >= depth) return EMPTY_CHAR;
  const row = model.layers[y]?.[depth - 1 - z];
  return row ? row[x] ?? EMPTY_CHAR : EMPTY_CHAR;
}

/**
 * Every filled cell of a model in build order: bottom-up, then front-to-back
 * and left-to-right inside a layer.
 */
export function modelCells(model) {
  const { width, height, depth } = model.size;
  const cells = [];
  for (let y = 0; y < height; y++) {
    for (let row = 0; row < depth; row++) {
      const z = depth - 1 - row;
      for (let x = 0; x < width; x++) {
        const char = charAt(model, x, y, z);
        if (char === EMPTY_CHAR) continue;
        cells.push({ x, y, z, char, color: CHAR_TO_COLOR[char] });
      }
    }
  }
  return cells;
}

/** Occupancy of a model as a flat `Uint8Array`, indexed by `cellIndex`. */
export function occupancyOf(model) {
  const { width, height, depth } = model.size;
  const occupancy = new Uint8Array(width * height * depth);
  for (const cell of modelCells(model)) occupancy[cellIndex(model.size, cell.x, cell.y, cell.z)] = 1;
  return occupancy;
}

/**
 * Greedily tiles a model into bricks, layer by layer from the ground up. Within
 * a layer it walks cells front-to-back / left-to-right and places the largest
 * footprint whose cells are all filled, unclaimed, and the same color — the
 * rule guided auto-build already uses.
 *
 * Because layers are emitted bottom-up and the voxelizer guarantees every cell
 * rests on a filled cell (or the baseplate), the returned order is always
 * physically placeable. Each entry is `[x, y, z, shapeId, rotation, char]` with
 * `x`/`z` at the footprint's minimum corner.
 */
export function planBuild(model) {
  const { width, height, depth } = model.size;
  const solution = [];
  const claimed = new Uint8Array(width * depth);

  for (let y = 0; y < height; y++) {
    claimed.fill(0);
    for (let row = 0; row < depth; row++) {
      const z = depth - 1 - row;
      for (let x = 0; x < width; x++) {
        const char = charAt(model, x, y, z);
        if (char === EMPTY_CHAR || claimed[x + width * z]) continue;

        for (const [w, d] of FOOTPRINTS) {
          // Footprints grow toward +x and toward the back (-z), matching the
          // front-to-back scan so an anchor is always the corner reached first.
          const z0 = z - (d - 1);
          if (x + w > width || z0 < 0) continue;

          let fits = true;
          for (let dz = 0; dz < d && fits; dz++) {
            for (let dx = 0; dx < w; dx++) {
              const cx = x + dx;
              const cz = z0 + dz;
              if (claimed[cx + width * cz] || charAt(model, cx, y, cz) !== char) {
                fits = false;
                break;
              }
            }
          }
          if (!fits) continue;

          const shape = footprintToShape(w, d);
          if (!shape) continue;
          for (let dz = 0; dz < d; dz++) {
            for (let dx = 0; dx < w; dx++) claimed[x + dx + width * (z0 + dz)] = 1;
          }
          solution.push([x, y, z0, shape.shape, shape.rotation, char]);
          break;
        }
      }
    }
  }
  return solution;
}

/**
 * Checks that a solution actually builds its model: every brick lands in
 * bounds, on empty cells, on top of something already placed (or the
 * baseplate), in the model's color — and that the finished stack covers the
 * model exactly. Returns the first few problems rather than throwing so a
 * dataset run can report on every model.
 */
export function validateSolution(model, solution = model.solution, { maxErrors = 5 } = {}) {
  const { width, height, depth } = model.size;
  const placed = new Uint8Array(width * height * depth);
  const errors = [];
  const fail = (message) => {
    if (errors.length < maxErrors) errors.push(message);
  };

  solution.forEach(([x, y, z, shape, rotation, char], index) => {
    const cells = brickCells(shape, rotation);
    if (!cells.length) fail(`brick ${index}: unknown shape ${shape}`);
    for (const { dx, dz } of cells) {
      const cx = x + dx;
      const cy = y;
      const cz = z + dz;
      if (cx < 0 || cy < 0 || cz < 0 || cx >= width || cy >= height || cz >= depth) {
        fail(`brick ${index}: cell ${cx},${cy},${cz} is out of bounds`);
        continue;
      }
      const flat = cellIndex(model.size, cx, cy, cz);
      if (placed[flat]) fail(`brick ${index}: cell ${cx},${cy},${cz} is already filled`);
      if (charAt(model, cx, cy, cz) !== char) {
        fail(`brick ${index}: cell ${cx},${cy},${cz} expects ${charAt(model, cx, cy, cz)}, got ${char}`);
      }
      if (cy > 0 && !placed[cellIndex(model.size, cx, cy - 1, cz)]) {
        fail(`brick ${index}: cell ${cx},${cy},${cz} has nothing underneath it`);
      }
      placed[flat] = 1;
    }
  });

  const occupancy = occupancyOf(model);
  let covered = 0;
  for (let i = 0; i < occupancy.length; i++) {
    if (occupancy[i] && placed[i]) covered++;
    else if (occupancy[i] !== placed[i]) fail(`cell ${i}: model ${occupancy[i]}, solution ${placed[i]}`);
  }

  return { ok: errors.length === 0, errors, brickCount: solution.length, cellCount: covered };
}

/**
 * Expands a solution into the bricks a renderer needs: grid coordinates
 * centered on x/z (the convention `src/blueprint.js` uses), the color key, and
 * the footprint's cell offsets.
 */
export function solutionBricks(model, solution = model.solution) {
  const leftX = -(model.size.width - 1) / 2;
  const frontZ = (model.size.depth - 1) / 2;
  return solution.map(([x, y, z, shape, rotation, char]) => ({
    x: leftX + x,
    y,
    z: z - frontZ,
    shape,
    rotation,
    color: CHAR_TO_COLOR[char],
    cells: brickCells(shape, rotation)
  }));
}

/**
 * Flattens a model into the same `{ x, y, z, color }` entries as
 * `DUCK_BLUEPRINT`, ordered by the build plan so a guided build can follow it
 * one cell at a time.
 */
export function toBlueprint(model, solution = model.solution) {
  const leftX = -(model.size.width - 1) / 2;
  const frontZ = (model.size.depth - 1) / 2;
  const entries = [];
  for (const [x, y, z, shape, rotation, char] of solution) {
    for (const { dx, dz } of brickCells(shape, rotation)) {
      entries.push({
        x: leftX + x + dx,
        y,
        z: (z + dz) - frontZ,
        color: CHAR_TO_COLOR[char]
      });
    }
  }
  return entries;
}
