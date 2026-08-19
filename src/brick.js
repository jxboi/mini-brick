import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Size of one grid cell / one 1x1 brick (footprint and height). */
export const CELL = 1;

const BRICK = CELL * 0.98;      // slight gap between neighbours
const STUD_R = CELL * 0.3;      // stud radius
const STUD_H = CELL * 0.22;     // stud height

/**
 * Named color palette used across the blueprint and the UI.
 * `hex` drives both the 3D material and the HUD swatch.
 */
export const COLORS = {
  white:    { hex: '#f7f7f2', name: 'white' },
  skyBlue:  { hex: '#5bb0e6', name: 'sky blue' },
  darkBlue: { hex: '#2f6fb0', name: 'blue' },
  black:    { hex: '#20242c', name: 'black' },
  yellow:   { hex: '#ffcf33', name: 'yellow' },
  red:      { hex: '#e23b3b', name: 'red' },
  pink:     { hex: '#f7a8bf', name: 'pink' }
};

/**
 * A single stud cylinder whose base sits at y = 0 and extends upward.
 * Reused by the baseplate (instanced) and merged into brick geometry.
 */
export function makeStud() {
  const geo = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 16);
  geo.translate(0, STUD_H / 2, 0);
  return geo;
}

/**
 * Geometry for one 1x1 brick, centered on the origin: the box spans
 * -CELL/2..+CELL/2 in Y, with a stud protruding from the top face.
 */
function makeBrickGeometry() {
  const box = new THREE.BoxGeometry(BRICK, CELL, BRICK);
  const stud = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 16);
  stud.translate(0, CELL / 2 + STUD_H / 2, 0);
  return mergeGeometries([box, stud], false);
}

// Shared geometry — every brick reuses it, only the material differs.
const BRICK_GEO = makeBrickGeometry();

/**
 * Available Free-Build brick footprints. Each shape is a list of grid-cell
 * offsets `{ dx, dz }` from the brick's anchor cell (the anchor is always
 * `{ dx: 0, dz: 0 }`). `w`/`d` are the bounding footprint in cells.
 */
export const SHAPES = [
  { id: '1x1', label: '1×1', w: 1, d: 1 },
  { id: '1x2', label: '1×2', w: 2, d: 1 },
  { id: '1x3', label: '1×3', w: 3, d: 1 },
  { id: '1x4', label: '1×4', w: 4, d: 1 },
  { id: '2x2', label: '2×2', w: 2, d: 2 },
  { id: '2x3', label: '2×3', w: 3, d: 2 },
  { id: '2x4', label: '2×4', w: 4, d: 2 }
].map((s) => ({ ...s, cells: rectCells(s.w, s.d) }));

const SHAPE_BY_ID = new Map(SHAPES.map((s) => [s.id, s]));

/** All cell offsets for a w×d footprint, anchored at (0,0). */
function rectCells(w, d) {
  const cells = [];
  for (let dz = 0; dz < d; dz++) {
    for (let dx = 0; dx < w; dx++) cells.push({ dx, dz });
  }
  return cells;
}

/**
 * Rotates a list of cell offsets 90° clockwise about the origin, then
 * re-normalizes so the minimum dx/dz is 0 (keeps the anchor at a corner).
 */
export function rotateCells(cells) {
  const rotated = cells.map(({ dx, dz }) => ({ dx: dz, dz: -dx }));
  const minX = Math.min(...rotated.map((c) => c.dx));
  const minZ = Math.min(...rotated.map((c) => c.dz));
  return rotated.map((c) => ({ dx: c.dx - minX, dz: c.dz - minZ }));
}

/**
 * Cell offsets for a shape id at a given rotation step (0 or 1 = 90°).
 * Non-recognized ids fall back to a single 1×1 cell.
 */
export function shapeCells(shapeId, rotation = 0) {
  const shape = SHAPE_BY_ID.get(shapeId);
  let cells = shape ? shape.cells : [{ dx: 0, dz: 0 }];
  for (let i = 0; i < ((rotation % 4) + 4) % 4; i++) cells = rotateCells(cells);
  return cells;
}

// Cache merged geometry per unique footprint signature so meshes/ghosts that
// share a shape+rotation reuse one BufferGeometry.
const shapeGeoCache = new Map();

function cellsSignature(cells) {
  return cells
    .map((c) => `${c.dx},${c.dz}`)
    .sort()
    .join('|');
}

/** Merged box+stud geometry spanning every cell offset, anchor at the origin. */
function geometryForCells(cells) {
  if (!cells || cells.length <= 1) return BRICK_GEO;
  const sig = cellsSignature(cells);
  if (!shapeGeoCache.has(sig)) {
    const parts = [];
    for (const { dx, dz } of cells) {
      const box = new THREE.BoxGeometry(BRICK, CELL, BRICK);
      box.translate(dx * CELL, 0, dz * CELL);
      const stud = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 16);
      stud.translate(dx * CELL, CELL / 2 + STUD_H / 2, dz * CELL);
      parts.push(box, stud);
    }
    shapeGeoCache.set(sig, mergeGeometries(parts, false));
  }
  return shapeGeoCache.get(sig);
}

// Cache one material per color so meshes of the same color share it.
const materialCache = new Map();

function materialFor(colorKey) {
  if (!materialCache.has(colorKey)) {
    const c = COLORS[colorKey] ?? COLORS.white;
    materialCache.set(
      colorKey,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(c.hex),
        roughness: 0.55,
        metalness: 0.0
      })
    );
  }
  return materialCache.get(colorKey);
}

/** World-space center position for a grid cell (bricks stack upward). */
export function cellToWorld(x, y, z) {
  return new THREE.Vector3(x * CELL, y * CELL + CELL / 2, z * CELL);
}

/**
 * Creates a solid brick mesh anchored at the given grid cell and color key.
 * `cells` is a list of `{ dx, dz }` offsets defining the footprint (defaults to
 * a single 1×1 cell). The mesh carries the covered grid cells in `userData` for
 * occupancy/undo/lookup.
 */
export function createBrick(x, y, z, colorKey, cells = [{ dx: 0, dz: 0 }]) {
  const mesh = new THREE.Mesh(geometryForCells(cells), materialFor(colorKey));
  mesh.position.copy(cellToWorld(x, y, z));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = {
    grid: { x, y, z },
    colorKey,
    cells: cells.map((c) => ({ x: x + c.dx, y, z: z + c.dz }))
  };
  return mesh;
}

/**
 * Creates the translucent "ghost" brick that marks where the next piece
 * goes. It pulses via `updateGhost` and tints to the upcoming color.
 * Pass `cells` to preview a multi-cell footprint.
 */
export function createGhost(cells = [{ dx: 0, dz: 0 }]) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ffffff'),
    transparent: true,
    opacity: 0.4,
    roughness: 0.3,
    metalness: 0.0,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0.25,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(geometryForCells(cells), mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 2;
  return mesh;
}

/**
 * Swaps the ghost's geometry to match a new footprint. Cached shape geometry is
 * shared, so nothing is disposed here.
 */
export function setGhostShape(ghost, cells) {
  ghost.geometry = geometryForCells(cells);
}

/** Positions + tints the ghost for a blueprint entry and pulses its opacity. */
export function updateGhost(ghost, entry, timeSeconds) {
  if (!entry) {
    ghost.visible = false;
    return;
  }
  ghost.visible = true;
  ghost.position.copy(cellToWorld(entry.x, entry.y, entry.z));
  const c = COLORS[entry.color] ?? COLORS.white;
  ghost.material.color.set(c.hex);
  ghost.material.emissive.set(c.hex);
  const pulse = 0.32 + 0.22 * (0.5 + 0.5 * Math.sin(timeSeconds * 4));
  ghost.material.opacity = pulse;
}
