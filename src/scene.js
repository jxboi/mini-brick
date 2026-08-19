import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CELL, makeStud } from './brick.js';

/**
 * Creates the renderer, scene, camera, lights, controls and a studded
 * baseplate. Returns handles the rest of the app needs.
 */
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#8ecae6');

  // Soft gradient-ish fog to give depth against the sky.
  scene.fog = new THREE.Fog('#8ecae6', 34, 70);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );
  camera.position.set(14, 13, 18);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 6;
  controls.maxDistance = 48;
  controls.maxPolarAngle = Math.PI * 0.495; // don't go under the floor
  controls.target.set(0, 6, 0);

  // ---- Lighting ------------------------------------------------------------
  const hemi = new THREE.HemisphereLight('#ffffff', '#6b7a99', 0.75);
  scene.add(hemi);

  const key = new THREE.DirectionalLight('#fff7e6', 1.15);
  key.position.set(16, 26, 14);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 80;
  const s = 26;
  key.shadow.camera.left = -s;
  key.shadow.camera.right = s;
  key.shadow.camera.top = s;
  key.shadow.camera.bottom = -s;
  key.shadow.bias = -0.0004;
  scene.add(key);

  const fill = new THREE.DirectionalLight('#cfe8ff', 0.35);
  fill.position.set(-14, 10, -10);
  scene.add(fill);

  // ---- Baseplate -----------------------------------------------------------
  scene.add(createBaseplate());

  // ---- Resize handling -----------------------------------------------------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, controls };
}

/**
 * A large green studded baseplate centered at the origin, sitting so its top
 * surface is at y = 0 (bricks stack upward from there).
 */
function createBaseplate() {
  const group = new THREE.Group();
  const size = 24; // cells across
  const thickness = 0.6;

  const plateGeo = new THREE.BoxGeometry(size * CELL, thickness, size * CELL);
  const plateMat = new THREE.MeshStandardMaterial({
    color: '#5aa459',
    roughness: 0.85,
    metalness: 0.0
  });
  const plate = new THREE.Mesh(plateGeo, plateMat);
  plate.position.y = -thickness / 2;
  plate.receiveShadow = true;
  group.add(plate);

  // Studs across the plate, instanced for performance.
  const studGeo = makeStud();
  const studMat = plateMat;
  const count = size * size;
  const studs = new THREE.InstancedMesh(studGeo, studMat, count);
  studs.receiveShadow = true;
  studs.castShadow = false;

  const dummy = new THREE.Object3D();
  let i = 0;
  const half = size / 2;
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      dummy.position.set((x - half) * CELL, 0, (z - half) * CELL);
      dummy.updateMatrix();
      studs.setMatrixAt(i++, dummy.matrix);
    }
  }
  studs.instanceMatrix.needsUpdate = true;
  group.add(studs);

  return group;
}
