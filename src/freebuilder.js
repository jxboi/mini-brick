import * as THREE from 'three';
import {
  createBrick,
  createGhost,
  setGhostShape,
  cellToWorld,
  shapeCells,
  SHAPES,
  COLORS
} from './brick.js';
import { DUCK_BLUEPRINT } from './blueprint.js';

/** Order the color swatches appear in the palette. */
export const PALETTE = ['red', 'yellow', 'skyBlue', 'darkBlue', 'white', 'pink', 'black'];

/**
 * Free-build sandbox mode: the player picks a color and drags a brick onto the
 * board to place it anywhere. Bricks snap to an integer grid and stack on top of
 * or beside existing bricks. Right-click removes. An optional translucent duck
 * overlay can be shown for inspiration.
 *
 * Only one mode is "active" at a time; `setActive` toggles this mode's meshes.
 */
export class FreeBuilder {
  constructor(scene) {
    this.scene = scene;
    this.listeners = new Set();

    this.active = false;
    this.half = 11;        // placement bounds within the baseplate footprint
    this.maxY = 40;        // sane stacking ceiling
    this.selectedColor = 'red';
    this.selectedShape = '1x1';
    this.rotation = 0;     // 0 or 1 → 90° steps
    this.guideOn = false;
    this.dragging = false; // true while a palette/shape drag is in progress
    this._lastAnchor = null; // last hovered cell during a drag

    // Placed bricks.
    this.placedGroup = new THREE.Group();
    this.placedGroup.visible = false;
    scene.add(this.placedGroup);
    this.placedMeshes = [];
    this.occupancy = new Map(); // "x,y,z" -> mesh

    // Hover ghost shown while dragging.
    this.ghost = createGhost(this._shapeCells());
    this.ghost.visible = false;
    scene.add(this.ghost);

    // Optional translucent duck overlay to build along with.
    this.guideGroup = this._buildGuide();
    this.guideGroup.visible = false;
    scene.add(this.guideGroup);
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
    const c = COLORS[this.selectedColor];
    const shape = SHAPES.find((s) => s.id === this.selectedShape);
    return {
      placed: this.placedMeshes.length,
      selectedColor: this.selectedColor,
      selectedName: c ? c.name : null,
      selectedHex: c ? c.hex : null,
      selectedShape: this.selectedShape,
      shapeLabel: shape ? shape.label : null,
      canRotate: shape ? shape.w !== shape.d : false,
      rotation: this.rotation,
      guideOn: this.guideOn
    };
  }

  // ---- Mode visibility -----------------------------------------------------
  setActive(v) {
    this.active = v;
    this.placedGroup.visible = v;
    this.guideGroup.visible = v && this.guideOn;
    if (!v) this.ghost.visible = false;
  }

  // ---- Color / shape selection ---------------------------------------------
  selectColor(key) {
    if (!COLORS[key]) return;
    this.selectedColor = key;
    this._tintGhost();
    this._emit();
  }

  selectShape(id) {
    if (!SHAPES.some((s) => s.id === id)) return;
    this.selectedShape = id;
    this.rotation = 0;
    this._refreshGhostShape();
    this._emit();
  }

  rotate() {
    const shape = SHAPES.find((s) => s.id === this.selectedShape);
    if (!shape || shape.w === shape.d) return; // square: rotation is a no-op
    this.rotation = (this.rotation + 1) % 2;
    this._refreshGhostShape();
    // While dragging, re-preview at the last hovered cell with the new orientation.
    if (this.dragging && this._lastAnchor) {
      if (this.isValidPlacement(this._lastAnchor)) this.showGhostAt(this._lastAnchor);
      else this.hideGhost();
    }
    this._emit();
  }

  // ---- Drag lifecycle ------------------------------------------------------
  beginDrag() {
    this.dragging = true;
  }

  endDrag() {
    this.dragging = false;
    this._lastAnchor = null;
    this.hideGhost();
  }

  /** Current shape's cell offsets, accounting for rotation. */
  _shapeCells() {
    return shapeCells(this.selectedShape, this.rotation);
  }

  _refreshGhostShape() {
    setGhostShape(this.ghost, this._shapeCells());
    this._tintGhost();
  }

  /** Absolute grid cells the current shape would cover, anchored at `anchor`. */
  cellsFor(anchor) {
    return this._shapeCells().map((c) => ({
      x: anchor.x + c.dx,
      y: anchor.y,
      z: anchor.z + c.dz
    }));
  }

  // ---- Grid helpers --------------------------------------------------------
  _key(c) {
    return `${c.x},${c.y},${c.z}`;
  }

  isOccupied(c) {
    return this.occupancy.has(this._key(c));
  }

  inBounds(c) {
    return (
      c.y >= 0 &&
      c.y <= this.maxY &&
      Math.abs(c.x) <= this.half &&
      Math.abs(c.z) <= this.half
    );
  }

  isValid(c) {
    return this.inBounds(c) && !this.isOccupied(c);
  }

  /** True when every cell the current shape covers (anchored here) is free. */
  isValidPlacement(anchor) {
    return this.cellsFor(anchor).every((c) => this.isValid(c));
  }

  // ---- Placement / removal -------------------------------------------------
  placeAt(anchor, colorKey = this.selectedColor) {
    if (!this.isValidPlacement(anchor)) return false;
    const cells = this._shapeCells();
    const mesh = createBrick(anchor.x, anchor.y, anchor.z, colorKey, cells);
    this.placedGroup.add(mesh);
    this.placedMeshes.push(mesh);
    for (const cell of mesh.userData.cells) this.occupancy.set(this._key(cell), mesh);
    this._emit();
    return true;
  }

  removeMesh(mesh) {
    const cells = mesh?.userData?.cells;
    if (!cells) return false;
    this.placedGroup.remove(mesh);
    for (const cell of cells) this.occupancy.delete(this._key(cell));
    const i = this.placedMeshes.indexOf(mesh);
    if (i >= 0) this.placedMeshes.splice(i, 1);
    this._emit();
    return true;
  }

  undo() {
    const mesh = this.placedMeshes[this.placedMeshes.length - 1];
    if (!mesh) return false;
    return this.removeMesh(mesh);
  }

  reset() {
    for (const mesh of this.placedMeshes.slice()) this.placedGroup.remove(mesh);
    this.placedMeshes = [];
    this.occupancy.clear();
    this._emit();
  }

  toggleGuide() {
    this.guideOn = !this.guideOn;
    this.guideGroup.visible = this.active && this.guideOn;
    this._emit();
  }

  // ---- Hover ghost ---------------------------------------------------------
  showGhostAt(cell) {
    this._lastAnchor = { x: cell.x, y: cell.y, z: cell.z };
    this.ghost.visible = true;
    this.ghost.position.copy(cellToWorld(cell.x, cell.y, cell.z));
    this._tintGhost();
  }

  hideGhost() {
    this.ghost.visible = false;
  }

  _tintGhost() {
    const c = COLORS[this.selectedColor] ?? COLORS.white;
    this.ghost.material.color.set(c.hex);
    this.ghost.material.emissive.set(c.hex);
  }

  // ---- Frame update --------------------------------------------------------
  update(elapsed) {
    if (!this.active || !this.ghost.visible) return;
    this.ghost.material.opacity = 0.34 + 0.2 * (0.5 + 0.5 * Math.sin(elapsed * 4));
  }

  // ---- Internals -----------------------------------------------------------
  _buildGuide() {
    const group = new THREE.Group();
    for (const entry of DUCK_BLUEPRINT) {
      const c = COLORS[entry.color] ?? COLORS.white;
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(c.hex),
        transparent: true,
        opacity: 0.16,
        depthWrite: false
      });
      const geo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(cellToWorld(entry.x, entry.y, entry.z));
      group.add(mesh);
    }
    return group;
  }
}
