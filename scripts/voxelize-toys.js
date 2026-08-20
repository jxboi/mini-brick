/**
 * Turns the photographed mini-brick toys in `assets/toys/` into voxel models
 * and buildable brick solutions, then writes them to `src/toys/models.data.js`.
 *
 * A single photo carries no true depth, so the pipeline is deliberately
 * explicit about what it does know and what it invents:
 *
 *   1. Segment the toy from the (near-white) studio background using color
 *      distance plus edge energy, keep the largest blob, and fill its holes.
 *      That drops watermarks, packaging text, and stray props.
 *   2. Sample the blob into a `width × height` grid — this is measured data:
 *      the front silhouette and the palette-quantized front color.
 *   3. Invent depth by revolving every horizontal run of the silhouette about
 *      its own vertical axis, so a round head becomes a ball and a thin antenna
 *      stays thin. The front view of the model always matches the photo.
 *   4. Drop a support cell under anything floating so the stack obeys the same
 *      support rule as `VoxelEnvironment`, making a bottom-up build order valid
 *      by construction.
 *   5. Tile every layer into 1×1 … 2×4 bricks and record the placement order.
 *   6. Downsample to the 4×4×4 occupancy grid the Agent Lab DQN trains on.
 *
 * Usage:
 *   node scripts/voxelize-toys.js [--size 16] [--depth-scale 0.7]
 *                                 [--input assets/toys] [--out src/toys/models.data.js]
 *                                 [--preview <dir>] [--limit N]
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { TOY_PALETTE, EMPTY_CHAR, quantize } from '../src/toys/palette.js';
import { planBuild, validateSolution } from '../src/toys/model.js';
import { GRID_SIZE, VOXEL_COUNT, voxelIndex, hashVoxels } from '../src/rl/targets.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_EXTENSIONS = new Set(['.webp', '.jpg', '.jpeg', '.png']);

/** Working resolution for segmentation — big enough for detail, small enough to be quick. */
const WORK_SIZE = 384;
/** Fraction of a grid cell that must be foreground before the cell is filled. */
const COVERAGE_THRESHOLD = 0.5;
/** Relaxed threshold used when the strict pass leaves almost nothing behind. */
const FALLBACK_COVERAGE = 0.3;
/** Fraction of a 4×4 block's columns that must be filled to raise a DQN tower. */
const TARGET_COLUMN_THRESHOLD = 0.35;
/** A blob this large relative to its own bounding box is a flat product shot. */
const FLAT_FILL_RATIO = 0.92;
/** Same, for photos whose backdrop is not the usual near-white studio white. */
const FLAT_FILL_RATIO_COLORED_BACKDROP = 0.75;

// ---- CLI -------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    size: 16,
    depthScale: 0.7,
    input: join(ROOT, 'assets/toys'),
    out: join(ROOT, 'src/toys/models.data.js'),
    preview: null,
    limit: Infinity
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--size') options.size = Number(value);
    else if (key === '--depth-scale') options.depthScale = Number(value);
    else if (key === '--input') options.input = resolve(value);
    else if (key === '--out') options.out = resolve(value);
    else if (key === '--preview') options.preview = resolve(value);
    else if (key === '--limit') options.limit = Number(value);
    else throw new Error(`Unknown option: ${key}`);
  }
  return options;
}

// ---- Segmentation ----------------------------------------------------------

async function loadImage(file) {
  const { data, info } = await sharp(file)
    .flatten({ background: '#ffffff' })
    .resize({ width: WORK_SIZE, height: WORK_SIZE, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function medianOf(values) {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.floor(sorted.length / 2)];
}

/** Median color of a thin frame around the image — the studio backdrop. */
function backgroundColor({ data, width, height }) {
  const frame = Math.max(2, Math.round(Math.min(width, height) * 0.02));
  const channels = [[], [], []];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onFrame = x < frame || y < frame || x >= width - frame || y >= height - frame;
      if (!onFrame) continue;
      const offset = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) channels[c].push(data[offset + c]);
    }
  }
  return channels.map((values) => medianOf(values));
}

function grayscale({ data, width, height }) {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 3;
    gray[i] = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
  }
  return gray;
}

/** Sobel magnitude — brick seams and studs give white-on-white toys an outline. */
function edgeEnergy(gray, width, height) {
  const energy = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = (dx, dy) => gray[(y + dy) * width + (x + dx)];
      const gx = at(-1, -1) + 2 * at(-1, 0) + at(-1, 1) - at(1, -1) - 2 * at(1, 0) - at(1, 1);
      const gy = at(-1, -1) + 2 * at(0, -1) + at(1, -1) - at(-1, 1) - 2 * at(0, 1) - at(1, 1);
      energy[y * width + x] = Math.hypot(gx, gy);
    }
  }
  return energy;
}

/** 3×3 dilate/erode over a binary mask. */
function morph(mask, width, height, grow) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = grow ? 0 : 1;
      for (let dy = -1; dy <= 1 && hit === (grow ? 0 : 1); dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          const value = ny < 0 || nx < 0 || ny >= height || nx >= width ? 0 : mask[ny * width + nx];
          if (grow && value) { hit = 1; break; }
          if (!grow && !value) { hit = 0; break; }
        }
      }
      out[y * width + x] = hit;
    }
  }
  return out;
}

/** Keeps the largest 8-connected blob and discards everything else. */
function largestBlob(mask, width, height) {
  const labels = new Int32Array(mask.length).fill(-1);
  const queue = new Int32Array(mask.length);
  let best = null;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = start;
    const members = [];
    while (head < tail) {
      const index = queue[head++];
      members.push(index);
      const x = index % width;
      const y = (index / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbour = ny * width + nx;
          if (!mask[neighbour] || labels[neighbour] !== -1) continue;
          labels[neighbour] = start;
          queue[tail++] = neighbour;
        }
      }
    }
    if (!best || members.length > best.length) best = members;
  }

  const out = new Uint8Array(mask.length);
  for (const index of best ?? []) out[index] = 1;
  return out;
}

/** Fills enclosed background pixels — white toy parts read as background. */
function fillHoles(mask, width, height) {
  const outside = new Uint8Array(mask.length);
  const queue = [];
  const push = (x, y) => {
    const index = y * width + x;
    if (mask[index] || outside[index]) return;
    outside[index] = 1;
    queue.push(index);
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  while (queue.length) {
    const index = queue.pop();
    const x = index % width;
    const y = (index / width) | 0;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }
  const out = Uint8Array.from(mask);
  for (let i = 0; i < out.length; i++) if (!outside[i]) out[i] = 1;
  return out;
}

function foregroundMask(image) {
  const { data, width, height } = image;
  const background = backgroundColor(image);
  const gray = grayscale(image);
  const energy = edgeEnergy(gray, width, height);

  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const offset = i * 3;
    const distance = Math.max(
      Math.abs(data[offset] - background[0]),
      Math.abs(data[offset + 1] - background[1]),
      Math.abs(data[offset + 2] - background[2])
    );
    mask[i] = distance > 26 || energy[i] > 48 ? 1 : 0;
  }

  let cleaned = morph(mask, width, height, true);
  cleaned = morph(cleaned, width, height, true);
  cleaned = morph(cleaned, width, height, false);
  cleaned = largestBlob(cleaned, width, height);
  cleaned = fillHoles(cleaned, width, height);
  cleaned = morph(cleaned, width, height, false);
  return { mask: largestBlob(cleaned, width, height), background };
}

function boundingBox(mask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// ---- Silhouette → grid -----------------------------------------------------

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Samples the segmented photo into a front-facing grid of palette characters.
 * Row 0 of the returned `chars` grid is the ground layer (y = 0).
 */
function sampleGrid(image, mask, box, gridWidth, gridHeight, coverage) {
  const { data, width } = image;
  const chars = new Array(gridWidth * gridHeight).fill(EMPTY_CHAR);

  for (let gy = 0; gy < gridHeight; gy++) {
    // Grid y counts up from the ground; image rows count down from the top.
    const y0 = box.minY + Math.floor(((gridHeight - 1 - gy) * box.height) / gridHeight);
    const y1 = box.minY + Math.floor(((gridHeight - gy) * box.height) / gridHeight);
    for (let gx = 0; gx < gridWidth; gx++) {
      const x0 = box.minX + Math.floor((gx * box.width) / gridWidth);
      const x1 = box.minX + Math.floor(((gx + 1) * box.width) / gridWidth);

      let total = 0;
      let hits = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = y0; y < Math.max(y1, y0 + 1); y++) {
        for (let x = x0; x < Math.max(x1, x0 + 1); x++) {
          total++;
          if (!mask[y * width + x]) continue;
          hits++;
          const offset = (y * width + x) * 3;
          r += data[offset];
          g += data[offset + 1];
          b += data[offset + 2];
        }
      }
      if (!total || hits / total < coverage) continue;
      chars[gy * gridWidth + gx] = quantize(r / hits, g / hits, b / hits).char;
    }
  }
  return chars;
}

/** Drops grid specks that are not 4-connected to the main silhouette. */
function keepLargestGridBlob(chars, gridWidth, gridHeight) {
  const seen = new Uint8Array(chars.length);
  let best = [];
  for (let start = 0; start < chars.length; start++) {
    if (chars[start] === EMPTY_CHAR || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const members = [];
    while (stack.length) {
      const index = stack.pop();
      members.push(index);
      const x = index % gridWidth;
      const y = (index / gridWidth) | 0;
      const neighbours = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of neighbours) {
        if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight) continue;
        const neighbour = ny * gridWidth + nx;
        if (chars[neighbour] === EMPTY_CHAR || seen[neighbour]) continue;
        seen[neighbour] = 1;
        stack.push(neighbour);
      }
    }
    if (members.length > best.length) best = members;
  }
  const keep = new Set(best);
  return chars.map((char, index) => (keep.has(index) ? char : EMPTY_CHAR));
}

// ---- Grid → voxels ---------------------------------------------------------

/**
 * Gives the flat silhouette a body. Each maximal horizontal run of filled cells
 * is treated as a circular cross-section revolved about the run's own vertical
 * axis, so cell depth follows the chord length of that circle. Cells stay
 * centered on the z axis, which keeps the model's front view identical to the
 * photo.
 */
function depthProfile(chars, gridWidth, gridHeight, depthScale, maxDepth) {
  const depths = new Int16Array(chars.length);
  for (let gy = 0; gy < gridHeight; gy++) {
    let x = 0;
    while (x < gridWidth) {
      if (chars[gy * gridWidth + x] === EMPTY_CHAR) { x++; continue; }
      let end = x;
      while (end + 1 < gridWidth && chars[gy * gridWidth + end + 1] !== EMPTY_CHAR) end++;

      const radius = (end - x + 1) / 2;
      const center = (x + end) / 2;
      for (let cx = x; cx <= end; cx++) {
        const halfChord = Math.sqrt(Math.max(0, radius * radius - (cx - center) ** 2));
        const depth = Math.round(2 * halfChord * depthScale);
        depths[gy * gridWidth + cx] = clamp(depth, 1, maxDepth);
      }
      x = end + 1;
    }
  }
  return depths;
}

/** Builds `layers[y][row]` ASCII rows (row 0 = front) from grid + depth. */
function extrude(chars, gridWidth, gridHeight, depths, gridDepth) {
  const layers = [];
  for (let y = 0; y < gridHeight; y++) {
    const rows = [];
    for (let row = 0; row < gridDepth; row++) rows.push(new Array(gridWidth).fill(EMPTY_CHAR));
    for (let x = 0; x < gridWidth; x++) {
      const char = chars[y * gridWidth + x];
      if (char === EMPTY_CHAR) continue;
      const depth = depths[y * gridWidth + x];
      const z0 = Math.round((gridDepth - depth) / 2);
      for (let z = z0; z < z0 + depth; z++) {
        if (z < 0 || z >= gridDepth) continue;
        rows[gridDepth - 1 - z][x] = char;
      }
    }
    layers.push(rows);
  }
  return layers;
}

/**
 * Drops a support cell beneath anything floating, walking top-down so a new
 * cell is itself supported on the next pass. Returns how many cells the photo
 * did not ask for — overhangs a real build has to prop up.
 */
function addSupports(layers, gridWidth, gridHeight, gridDepth) {
  let added = 0;
  for (let y = gridHeight - 1; y > 0; y--) {
    for (let row = 0; row < gridDepth; row++) {
      for (let x = 0; x < gridWidth; x++) {
        const char = layers[y][row][x];
        if (char === EMPTY_CHAR) continue;
        if (layers[y - 1][row][x] !== EMPTY_CHAR) continue;
        layers[y - 1][row][x] = char;
        added++;
      }
    }
  }
  return added;
}

// ---- 4×4×4 DQN target ------------------------------------------------------

/**
 * Reduces a model to the 4×4×4 occupancy grid `VoxelEnvironment` trains on.
 *
 * Block-downsampling the solid model would return an almost-full cube, so the
 * target is built from the model's column heights instead: each 4×4 footprint
 * block takes the mean height of the columns standing in it, scaled to four
 * layers. The result is a miniature skyline — every column filled from the
 * baseplate up — which is exactly the shape `generateTarget()` produces and is
 * therefore support-valid by construction.
 */
function toAgentTarget(layers, gridWidth, gridHeight, gridDepth) {
  const heights = new Int16Array(gridWidth * gridDepth);
  for (let z = 0; z < gridDepth; z++) {
    for (let x = 0; x < gridWidth; x++) {
      for (let y = gridHeight - 1; y >= 0; y--) {
        if (layers[y][gridDepth - 1 - z][x] === EMPTY_CHAR) continue;
        heights[x + gridWidth * z] = y + 1;
        break;
      }
    }
  }

  const span = (index, size) => {
    const from = Math.floor((index * size) / GRID_SIZE);
    return [from, Math.max(Math.floor(((index + 1) * size) / GRID_SIZE), from + 1)];
  };

  const voxels = new Uint8Array(VOXEL_COUNT);
  for (let bz = 0; bz < GRID_SIZE; bz++) {
    const [z0, z1] = span(bz, gridDepth);
    for (let bx = 0; bx < GRID_SIZE; bx++) {
      const [x0, x1] = span(bx, gridWidth);
      let columns = 0;
      let standing = 0;
      let total = 0;
      for (let z = z0; z < Math.min(z1, gridDepth); z++) {
        for (let x = x0; x < Math.min(x1, gridWidth); x++) {
          columns++;
          const height = heights[x + gridWidth * z];
          if (!height) continue;
          standing++;
          total += height;
        }
      }
      if (!columns || standing / columns < TARGET_COLUMN_THRESHOLD) continue;
      const mean = total / standing;
      const towerHeight = clamp(Math.round((mean * GRID_SIZE) / gridHeight), 1, GRID_SIZE);
      for (let y = 0; y < towerHeight; y++) voxels[voxelIndex(bx, y, bz)] = 1;
    }
  }

  let count = 0;
  for (const value of voxels) count += value;
  // `difficulty` is filled in once every model is known — see assignDifficulties().
  return { voxels: Array.from(voxels), count, difficulty: null, hash: hashVoxels(voxels) };
}

// ---- Per-image driver ------------------------------------------------------

async function voxelizeImage(file, options, index) {
  const image = await loadImage(file);
  const { mask, background } = foregroundMask(image);
  const box = boundingBox(mask, image.width, image.height);
  if (!box) return { skipped: 'no foreground found' };

  // Packaging shots — a boxed set on a colored backdrop, or artwork filling the
  // frame — segment as one near-rectangular blob and voxelize into a brick, not
  // a toy. Reject them instead of poisoning the dataset.
  let blobArea = 0;
  for (const value of mask) blobArea += value;
  const fillRatio = blobArea / (box.width * box.height);
  const whiteBackdrop = Math.min(...background) >= 225;
  if (fillRatio > (whiteBackdrop ? FLAT_FILL_RATIO : FLAT_FILL_RATIO_COLORED_BACKDROP)) {
    return { skipped: `no isolated subject (blob fills ${(fillRatio * 100).toFixed(0)}% of its box)` };
  }

  const maxSize = options.size;
  const aspect = box.width / box.height;
  let gridWidth;
  let gridHeight;
  if (aspect >= 1) {
    gridWidth = maxSize;
    gridHeight = clamp(Math.round(maxSize / aspect), 3, maxSize);
  } else {
    gridHeight = maxSize;
    gridWidth = clamp(Math.round(maxSize * aspect), 3, maxSize);
  }

  let chars = sampleGrid(image, mask, box, gridWidth, gridHeight, COVERAGE_THRESHOLD);
  let filled = chars.filter((char) => char !== EMPTY_CHAR).length;
  if (filled < gridWidth * gridHeight * 0.15) {
    chars = sampleGrid(image, mask, box, gridWidth, gridHeight, FALLBACK_COVERAGE);
    filled = chars.filter((char) => char !== EMPTY_CHAR).length;
  }
  if (filled < 8) return { skipped: 'silhouette too small to voxelize' };
  chars = keepLargestGridBlob(chars, gridWidth, gridHeight);

  const depths = depthProfile(chars, gridWidth, gridHeight, options.depthScale, maxSize);
  const gridDepth = clamp(Math.max(...depths), 1, maxSize);
  const layers = extrude(chars, gridWidth, gridHeight, depths, gridDepth);

  let silhouetteCells = 0;
  for (const rows of layers) {
    for (const row of rows) {
      for (const char of row) if (char !== EMPTY_CHAR) silhouetteCells++;
    }
  }
  const supportCells = addSupports(layers, gridWidth, gridHeight, gridDepth);

  const model = {
    id: `toy-${String(index + 1).padStart(3, '0')}`,
    source: basename(file),
    size: { width: gridWidth, height: gridHeight, depth: gridDepth },
    voxelCount: silhouetteCells + supportCells,
    supportCount: supportCells,
    layers: layers.map((rows) => rows.map((row) => row.join(''))),
    target4: toAgentTarget(layers, gridWidth, gridHeight, gridDepth)
  };
  model.solution = planBuild(model);
  model.brickCount = model.solution.length;

  const check = validateSolution(model);
  if (!check.ok) return { skipped: `invalid solution: ${check.errors[0]}` };
  return { model, mask, image, box };
}

/**
 * Labels the 4×4×4 targets easy/medium/hard by splitting the collection into
 * terciles of voxel count. Photographed toys are denser than the synthetic
 * skylines in `targets.js`, so the generator's absolute thresholds would call
 * almost every one of them hard; a relative split keeps all three curriculum
 * pools populated.
 */
function assignDifficulties(models) {
  const sorted = [...models].sort((a, b) => a.target4.count - b.target4.count);
  sorted.forEach((model, index) => {
    const tercile = Math.floor((index * 3) / Math.max(1, sorted.length));
    model.target4.difficulty = ['easy', 'medium', 'hard'][Math.min(2, tercile)];
  });
}

// ---- Preview ---------------------------------------------------------------

/** Renders the model's front face next to the source photo for eyeballing. */
async function writePreview(dir, model, sourceFile) {
  const scale = 12;
  const { width, height } = model.size;
  const canvas = Buffer.alloc(width * scale * height * scale * 3, 255);
  const rgbOf = (char) => TOY_PALETTE.find((entry) => entry.char === char)?.rgb ?? [255, 255, 255];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Front-most filled cell in this column of the layer.
      let char = EMPTY_CHAR;
      for (let row = 0; row < model.size.depth && char === EMPTY_CHAR; row++) {
        char = model.layers[y][row][x];
      }
      if (char === EMPTY_CHAR) continue;
      const [r, g, b] = rgbOf(char);
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          const cy = (height - 1 - y) * scale + py;
          const cx = x * scale + px;
          const offset = (cy * width * scale + cx) * 3;
          const edge = px === 0 || py === 0;
          canvas[offset] = edge ? r * 0.75 : r;
          canvas[offset + 1] = edge ? g * 0.75 : g;
          canvas[offset + 2] = edge ? b * 0.75 : b;
        }
      }
    }
  }

  const rendered = await sharp(canvas, { raw: { width: width * scale, height: height * scale, channels: 3 } })
    .resize({ width: 220, height: 220, fit: 'contain', background: '#ffffff', kernel: 'nearest' })
    .png()
    .toBuffer();
  const photo = await sharp(sourceFile)
    .flatten({ background: '#ffffff' })
    .resize({ width: 220, height: 220, fit: 'contain', background: '#ffffff' })
    .png()
    .toBuffer();

  await sharp({ create: { width: 440, height: 220, channels: 3, background: '#ffffff' } })
    .composite([{ input: photo, left: 0, top: 0 }, { input: rendered, left: 220, top: 0 }])
    .png()
    .toFile(join(dir, `${model.id}.png`));
}

// ---- Entry point -----------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const entries = (await readdir(options.input))
    .filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort();
  if (!entries.length) throw new Error(`No images found in ${options.input}`);

  let notes = {};
  try {
    const manifest = JSON.parse(await readFile(join(options.input, 'manifest.json'), 'utf8'));
    notes = Object.fromEntries(manifest.map((entry) => [entry.file, entry.note]));
  } catch {
    // A manifest is optional.
  }

  if (options.preview) await mkdir(options.preview, { recursive: true });

  const models = [];
  const skipped = [];
  for (const name of entries.slice(0, options.limit)) {
    const file = join(options.input, name);
    const result = await voxelizeImage(file, options, models.length);
    if (result.skipped) {
      skipped.push({ source: name, reason: result.skipped });
      process.stdout.write(`skip ${name}: ${result.skipped}\n`);
      continue;
    }
    if (notes[name]) result.model.note = notes[name];
    models.push(result.model);
    if (options.preview) await writePreview(options.preview, result.model, file);
    process.stdout.write(
      `${result.model.id}  ${name.padEnd(10)} ${String(result.model.size.width).padStart(2)}×` +
      `${String(result.model.size.height).padStart(2)}×${String(result.model.size.depth).padStart(2)}  ` +
      `${String(result.model.voxelCount).padStart(4)} voxels  ${String(result.model.brickCount).padStart(4)} bricks  ` +
      `${String(result.model.target4.count).padStart(2)} target voxels\n`
    );
  }

  assignDifficulties(models);

  const dataset = {
    version: 1,
    source: 'assets/toys',
    grid: { maxSize: options.size, depthScale: options.depthScale },
    palette: Object.fromEntries(TOY_PALETTE.map((entry) => [entry.char, entry.color])),
    models
  };

  const body = [
    '/**',
    ' * Voxelized mini-brick toys — GENERATED FILE, do not edit by hand.',
    ' *',
    ' * Regenerate with `npm run voxelize` after changing `assets/toys/` or the',
    ' * pipeline in `scripts/voxelize-toys.js`. See `src/toys/model.js` for the',
    ' * layer/solution format and `src/toys/dataset.js` for the accessors.',
    ' */',
    '',
    'export const TOY_DATASET = {',
    `  version: ${dataset.version},`,
    `  source: ${JSON.stringify(dataset.source)},`,
    `  grid: ${JSON.stringify(dataset.grid)},`,
    `  palette: ${JSON.stringify(dataset.palette)},`,
    '  models: [',
    ...models.map((model) => `    ${JSON.stringify(model)},`),
    '  ]',
    '};',
    '',
    'export default TOY_DATASET;',
    ''
  ].join('\n');

  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(options.out, body);

  const totals = models.reduce(
    (acc, model) => ({
      voxels: acc.voxels + model.voxelCount,
      supports: acc.supports + model.supportCount,
      bricks: acc.bricks + model.brickCount
    }),
    { voxels: 0, supports: 0, bricks: 0 }
  );
  const hashes = new Set(models.map((model) => model.target4.hash));
  const spread = models.reduce((acc, model) => {
    acc[model.target4.difficulty] = (acc[model.target4.difficulty] ?? 0) + 1;
    return acc;
  }, {});
  process.stdout.write(
    `\n${models.length} models written to ${options.out}` +
    `${skipped.length ? ` (${skipped.length} skipped)` : ''}\n` +
    `${totals.voxels} voxels total, ${totals.supports} added as support, ${totals.bricks} bricks total\n` +
    `${hashes.size} distinct 4×4×4 targets ` +
    `(easy ${spread.easy ?? 0} · medium ${spread.medium ?? 0} · hard ${spread.hard ?? 0})\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
