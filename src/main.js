import * as THREE from 'three';
import { createScene } from './scene.js';
import { Builder } from './builder.js';
import { FreeBuilder } from './freebuilder.js';
import { createUI } from './ui.js';
import { CELL } from './brick.js';

const canvas = document.getElementById('scene');
const { renderer, scene, camera, controls } = createScene(canvas);

const guided = new Builder(scene);
const free = new FreeBuilder(scene);

// Start in guided mode; hide the free-build meshes until selected.
guided.setActive(true);
free.setActive(false);

const ui = createUI(guided, free);

// ---- Shared raycasting -----------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmpPoint = new THREE.Vector3();

function setPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

/**
 * Given a pointer/drag event, work out which free-build grid cell it targets:
 * the top/side of a hovered brick (via its face normal), or the baseplate.
 * Returns `{ cell, valid }` or null when nothing sensible is under the cursor.
 */
function freeTargetFromEvent(event) {
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObjects(free.placedMeshes, false);
  let cell = null;

  if (hits.length > 0) {
    const hit = hits[0];
    const g = hit.object.userData.grid;
    const n = hit.face ? hit.face.normal : { x: 0, y: 1, z: 0 };
    cell = {
      x: g.x + Math.round(n.x),
      y: g.y + Math.round(n.y),
      z: g.z + Math.round(n.z)
    };
  } else {
    const p = raycaster.ray.intersectPlane(groundPlane, tmpPoint);
    if (p) {
      cell = { x: Math.round(p.x / CELL), y: 0, z: Math.round(p.z / CELL) };
    }
  }

  if (!cell) return null;
  return { cell, valid: free.isValidPlacement(cell) };
}

// ---- Drag & drop placement (Free Build mode) -------------------------------
// Placement uses a pointer-based drag (started from the HUD swatches/shapes in
// ui.js) rather than native HTML5 drag-and-drop, so that pressing `R` mid-drag
// can rotate the shape (native drag suppresses letter-key events).
function overCanvas(e) {
  return e.target === renderer.domElement;
}

window.addEventListener('pointermove', (e) => {
  if (ui.getMode() !== 'free' || !free.dragging) return;
  if (!overCanvas(e)) {
    free.hideGhost();
    return;
  }
  const target = freeTargetFromEvent(e);
  if (target && target.valid) free.showGhostAt(target.cell);
  else free.hideGhost();
});

window.addEventListener('pointerup', (e) => {
  if (!free.dragging) return;
  if (ui.getMode() === 'free' && overCanvas(e)) {
    const target = freeTargetFromEvent(e);
    if (target && target.valid) free.placeAt(target.cell);
  }
  free.endDrag();
});

window.addEventListener('pointercancel', () => {
  if (free.dragging) free.endDrag();
});

// ---- Click interactions ----------------------------------------------------
let downPos = null;

renderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY, button: e.button };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  const button = downPos.button;
  downPos = null;
  if (moved > 6) return; // treat as an orbit/pan drag, not a click

  const mode = ui.getMode();

  if (mode === 'guided') {
    if (button !== 0) return;
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    if (!guided.ghost.visible) return;
    const hits = raycaster.intersectObject(guided.ghost, false);
    if (hits.length > 0) guided.placeNext();
    return;
  }

  // Free mode: right-click removes the brick under the cursor.
  if (button === 2) {
    setPointer(e);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(free.placedMeshes, false);
    if (hits.length > 0) free.removeMesh(hits[0].object);
  }
});

// Suppress the browser context menu while in Free Build (used for removal).
renderer.domElement.addEventListener('contextmenu', (e) => {
  if (ui.getMode() === 'free') e.preventDefault();
});

// ---- Render loop -----------------------------------------------------------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsed = clock.elapsedTime;

  guided.update(elapsed, delta);
  free.update(elapsed);
  controls.update();
  renderer.render(scene, camera);
}

animate();
