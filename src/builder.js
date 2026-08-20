import * as THREE from 'three';
import {
  createBrick,
  createGhost,
  createPreviewBrick,
  setGhostShape,
  updateGhost,
  COLORS
} from './brick.js';
import { getBlueprint, DEFAULT_BLUEPRINT_ID } from './blueprints.js';

/** Seconds a full auto-build should take, whatever the model's size. */
const AUTO_BUILD_BUDGET = 8;
const AUTO_MIN_INTERVAL = 0.02;
const AUTO_MAX_INTERVAL = 0.16;

/** Largest frame step auto-build will honour, so a backgrounded tab can't
 *  return with a multi-second delta and dump hundreds of bricks in one frame. */
const MAX_AUTO_DELTA = 0.25;

/** Seconds between auto placements for a model of `bricks` pieces. */
export function autoIntervalFor(bricks) {
  const interval = AUTO_BUILD_BUDGET / Math.max(bricks, 1);
  return Math.min(AUTO_MAX_INTERVAL, Math.max(AUTO_MIN_INTERVAL, interval));
}

/**
 * Drives the guided build: which brick is next, the pulsing ghost slot,
 * placing / undoing bricks, auto-build, reset, and the target preview.
 * Emits a state object to subscribers whenever anything changes.
 *
 * The build follows the selected model's brick plan — the same validated
 * `solution` the dataset ships (see `src/toys/model.js`) — so each step places
 * one real brick with its own footprint rather than a single 1x1 cell.
 */
export class Builder {
  constructor(scene, entry = getBlueprint(DEFAULT_BLUEPRINT_ID)) {
    this.scene = scene;
    this.listeners = new Set();
    this.active = true; // whether this mode is currently shown
    this.previewOn = false; // whether the target preview is toggled on

    // Group holding placed bricks.
    this.placedGroup = new THREE.Group();
    this.placedMeshes = [];
    scene.add(this.placedGroup);

    // Ghost marking the next brick (also the raycast target for clicks).
    this.ghost = createGhost();
    scene.add(this.ghost);

    // Translucent preview of the full target (toggleable). Rebuilt per model.
    this.previewGroup = new THREE.Group();
    this.previewGroup.visible = false;
    scene.add(this.previewGroup);

    // Auto-build state.
    this.autoBuilding = false;
    this._autoTimer = 0;
    this._autoInterval = AUTO_MAX_INTERVAL;

    this.setBlueprint(entry);
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
    const nextBrick = this.nextBrick;
    const color = nextBrick ? COLORS[nextBrick.color] : null;
    return {
      blueprintId: this.entry.id,
      blueprintName: this.entry.name,
      size: this.size,
      placed: this.stepIndex,
      total: this.total,
      cells: this.placedCells,
      totalCells: this.entry.cellCount,
      done: this.stepIndex >= this.total,
      autoBuilding: this.autoBuilding,
      previewOn: this.previewOn,
      nextColorName: color ? color.name : null,
      nextColorHex: color ? color.hex : null
    };
  }

  // ---- Blueprint selection -------------------------------------------------
  /**
   * Switches to another model from the catalog: loads its brick plan, clears
   * whatever was on the board, and rebuilds the target preview.
   */
  setBlueprint(entry) {
    const { bricks, size } = entry.load();
    this.entry = entry;
    this.plan = bricks;
    this.size = size;
    this.total = bricks.length;
    this._autoInterval = autoIntervalFor(this.total);

    this._clearPlacement();
    this._rebuildPreview();
    this._refreshGhost();
    this._emit();
  }

  // ---- Core actions --------------------------------------------------------
  placeNext() {
    if (!this._placeStep()) return false;
    this._refreshGhost();
    this._emit();
    return true;
  }

  undo() {
    if (this.placedMeshes.length === 0) return false;
    const mesh = this.placedMeshes.pop();
    this.placedGroup.remove(mesh);
    this.stepIndex--;
    this.placedCells -= mesh.userData.cells.length;
    this.autoBuilding = false;
    this._refreshGhost();
    this._emit();
    return true;
  }

  reset() {
    this._clearPlacement();
    this._refreshGhost();
    this._emit();
  }

  toggleAutoBuild() {
    if (this.stepIndex >= this.total) return;
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
    updateGhost(this.ghost, this.nextBrick, elapsed);

    if (!this.autoBuilding) return;

    // Place as many bricks as the elapsed time allows, then emit once. A model
    // can run to 450 bricks, and emitting per placement would re-run the whole
    // HUD update that many times.
    this._autoTimer += Math.min(delta, MAX_AUTO_DELTA);
    let placed = 0;
    while (this._autoTimer >= this._autoInterval && this.autoBuilding) {
      this._autoTimer -= this._autoInterval;
      if (this._placeStep()) placed++;
      else this.autoBuilding = false;
    }
    if (placed === 0 && this.autoBuilding) return;
    this._refreshGhost();
    this._emit();
  }

  // ---- Internals -----------------------------------------------------------
  /** Places the next brick of the plan. Does not refresh the ghost or emit. */
  _placeStep() {
    const brick = this.plan[this.stepIndex];
    if (!brick) return false;
    const mesh = createBrick(brick.x, brick.y, brick.z, brick.color, brick.cells);
    this.placedGroup.add(mesh);
    this.placedMeshes.push(mesh);
    this.stepIndex++;
    this.placedCells += brick.cells.length;
    return true;
  }

  _clearPlacement() {
    for (const mesh of this.placedMeshes) this.placedGroup.remove(mesh);
    this.placedMeshes = [];
    this.stepIndex = 0;
    this.placedCells = 0;
    this.autoBuilding = false;
    this._autoTimer = 0;
  }

  _refreshGhost() {
    this.nextBrick = this.plan[this.stepIndex] ?? null;
    if (this.nextBrick) setGhostShape(this.ghost, this.nextBrick.cells);
    updateGhost(this.ghost, this.nextBrick, 0);
    this._syncPreview();
  }

  _syncPreview() {
    if (!this.previewGroup.visible) return;
    // Show only the bricks that haven't been placed yet.
    const children = this.previewGroup.children;
    for (let i = 0; i < children.length; i++) children[i].visible = i >= this.stepIndex;
  }

  /**
   * Rebuilds the translucent target. `createPreviewBrick` hands back meshes
   * backed entirely by shared geometry and material caches, so emptying the
   * group is a complete teardown — there is nothing per-mesh to dispose.
   */
  _rebuildPreview() {
    this.previewGroup.clear();
    for (const brick of this.plan) {
      this.previewGroup.add(
        createPreviewBrick(brick.x, brick.y, brick.z, brick.color, brick.cells, 0.18)
      );
    }
    this.previewGroup.visible = this.previewOn && this.active;
    this._syncPreview();
  }
}
