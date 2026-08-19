import * as THREE from 'three';
import { createBrick, createGhost, updateGhost, cellToWorld, COLORS } from './brick.js';
import { DUCK_BLUEPRINT, TOTAL_BRICKS } from './blueprint.js';

/** Stable grid-cell key used for occupancy lookups. */
function cellKey(x, y, z) {
  return `${x},${y},${z}`;
}

/**
 * Rectangular footprints auto-build may use, in descending area order. Each is
 * `[w, d]` (x-extent × z-extent) and comes from the shapes the app supports
 * (1×1 … 2×4), including their rotated orientations. Auto-build tries these in
 * order and places the first one that fits, so it always uses the largest brick.
 */
const AUTO_FOOTPRINTS = [
  [2, 4], [4, 2], // area 8
  [2, 3], [3, 2], // area 6
  [1, 4], [4, 1], [2, 2], // area 4
  [1, 3], [3, 1], // area 3
  [1, 2], [2, 1], // area 2
  [1, 1] // area 1
];

/**
 * Drives the guided build: which brick is next, the pulsing ghost slot,
 * placing / undoing bricks, auto-build, reset, and the target preview.
 * Emits a state object to subscribers whenever anything changes.
 */
export class Builder {
  constructor(scene) {
    this.scene = scene;
    this.blueprint = DUCK_BLUEPRINT;
    this.total = TOTAL_BRICKS;
    this.listeners = new Set();
    this.active = true; // whether this mode is currently shown
    this.previewOn = false; // whether the target preview is toggled on

    // Cell-occupancy state. Each blueprint entry is a single 1x1 cell; placed
    // bricks may cover several cells (auto-build merges same-color neighbours).
    this.placedSet = new Set(); // "x,y,z" keys already placed
    this.placedCount = 0; // number of 1x1 cells placed (drives progress)
    this.cellColor = new Map(); // "x,y,z" -> colorKey, for every buildable cell
    for (const entry of this.blueprint) {
      this.cellColor.set(cellKey(entry.x, entry.y, entry.z), entry.color);
    }
    this.nextEntry = null; // next unplaced cell, in blueprint order

    // Group holding placed bricks.
    this.placedGroup = new THREE.Group();
    this.placedMeshes = [];
    scene.add(this.placedGroup);

    // Ghost marking the next slot (also the raycast target for clicks).
    this.ghost = createGhost();
    scene.add(this.ghost);

    // Translucent preview of the full target (toggleable).
    this.previewGroup = this._buildPreview();
    this.previewGroup.visible = false;
    scene.add(this.previewGroup);

    // Auto-build state.
    this.autoBuilding = false;
    this._autoTimer = 0;
    this._autoInterval = 0.16; // seconds between auto placements

    this._refreshGhost();
  }

  // ---- Subscription --------------------------------------------------------
  onChange(fn) {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  _emit() {
    const state = this.getState();
    for (const fn of this.listeners) fn(state);
  }

  getState() {
    const nextEntry = this.nextEntry;
    const color = nextEntry ? COLORS[nextEntry.color] : null;
    return {
      placed: this.placedCount,
      total: this.total,
      done: this.placedCount >= this.total,
      autoBuilding: this.autoBuilding,
      previewOn: this.previewOn,
      nextColorName: color ? color.name : null,
      nextColorHex: color ? color.hex : null
    };
  }

  // ---- Core actions --------------------------------------------------------
  placeNext() {
    if (!this.nextEntry) return false;
    const entry = this.nextEntry;
    this._placeBrick(entry, [{ dx: 0, dz: 0 }]);
    this._refreshGhost();
    this._emit();
    return true;
  }

  // Auto-build placement: cover the next unplaced cell with the largest brick
  // that fits (same colour + same layer + all cells still open).
  autoPlaceNext() {
    if (!this.nextEntry) return false;
    const entry = this.nextEntry;
    const cells = this._bestFootprint(entry);
    this._placeBrick(entry, cells);
    this._refreshGhost();
    this._emit();
    return true;
  }

  undo() {
    if (this.placedMeshes.length === 0) return false;
    const mesh = this.placedMeshes.pop();
    this.placedGroup.remove(mesh);
    for (const cell of mesh.userData.cells) {
      this.placedSet.delete(cellKey(cell.x, cell.y, cell.z));
      this.placedCount--;
    }
    this.autoBuilding = false;
    this._refreshGhost();
    this._emit();
    return true;
  }

  reset() {
    for (const mesh of this.placedMeshes) this.placedGroup.remove(mesh);
    this.placedMeshes = [];
    this.placedSet.clear();
    this.placedCount = 0;
    this.autoBuilding = false;
    this._refreshGhost();
    this._emit();
  }

  toggleAutoBuild() {
    if (this.placedCount >= this.total) return;
    this.autoBuilding = !this.autoBuilding;
    this._autoTimer = 0;
    this._emit();
  }

  togglePreview() {
    this.previewOn = !this.previewOn;
    this.previewGroup.visible = this.previewOn && this.active;
    this._syncPreview();
    this._emit();
  }

  // ---- Mode visibility -----------------------------------------------------
  setActive(v) {
    this.active = v;
    this.placedGroup.visible = v;
    this.previewGroup.visible = v && this.previewOn;
    if (v) {
      this._refreshGhost();
    } else {
      this.ghost.visible = false;
    }
  }

  // ---- Frame update --------------------------------------------------------
  update(elapsed, delta) {
    if (!this.active) return;
    updateGhost(this.ghost, this.nextEntry, elapsed);

    if (this.autoBuilding) {
      this._autoTimer += delta;
      while (this._autoTimer >= this._autoInterval && this.autoBuilding) {
        this._autoTimer -= this._autoInterval;
        const placed = this.autoPlaceNext();
        if (!placed) {
          this.autoBuilding = false;
          this._emit();
        }
      }
    }
  }

  // ---- Internals -----------------------------------------------------------
  _placeBrick(entry, cells) {
    const mesh = createBrick(entry.x, entry.y, entry.z, entry.color, cells);
    this.placedGroup.add(mesh);
    this.placedMeshes.push(mesh);
    for (const cell of mesh.userData.cells) {
      this.placedSet.add(cellKey(cell.x, cell.y, cell.z));
      this.placedCount++;
    }
  }

  // First blueprint cell (bottom-up, front→back, left→right) still open.
  _computeNext() {
    this.nextEntry = null;
    for (const entry of this.blueprint) {
      if (!this.placedSet.has(cellKey(entry.x, entry.y, entry.z))) {
        this.nextEntry = entry;
        return;
      }
    }
  }

  // Largest supported footprint that fits at `anchor`: every covered cell must
  // exist, share the anchor's colour, and still be unplaced. The rectangle
  // grows +x (right) and −z (toward the back) from the anchor corner.
  _bestFootprint(anchor) {
    for (const [w, d] of AUTO_FOOTPRINTS) {
      const cells = [];
      let fits = true;
      for (let i = 0; i < d && fits; i++) {
        for (let j = 0; j < w && fits; j++) {
          const key = cellKey(anchor.x + j, anchor.y, anchor.z - i);
          if (this.placedSet.has(key) || this.cellColor.get(key) !== anchor.color) {
            fits = false;
          } else {
            cells.push({ dx: j, dz: -i });
          }
        }
      }
      if (fits) return cells;
    }
    return [{ dx: 0, dz: 0 }];
  }

  _refreshGhost() {
    this._computeNext();
    updateGhost(this.ghost, this.nextEntry, 0);
    this._syncPreview();
  }

  _syncPreview() {
    if (!this.previewGroup.visible) return;
    // Show only cells that haven't been placed yet.
    for (const child of this.previewGroup.children) {
      child.visible = !this.placedSet.has(child.userData.key);
    }
  }

  _buildPreview() {
    const group = new THREE.Group();
    for (const entry of this.blueprint) {
      const c = COLORS[entry.color] ?? COLORS.white;
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(c.hex),
        transparent: true,
        opacity: 0.18,
        depthWrite: false
      });
      const geo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(cellToWorld(entry.x, entry.y, entry.z));
      mesh.userData.key = cellKey(entry.x, entry.y, entry.z);
      group.add(mesh);
    }
    return group;
  }
}
