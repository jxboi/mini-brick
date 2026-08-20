/**
 * The catalog of buildable models.
 *
 * Two sources feed it, and both arrive in the same record shape (a uniform grid
 * of ASCII layers plus a `size`), so there is exactly one decoding path:
 *
 *   - the hand-authored duck, `DUCK_MODEL` in `src/blueprint.js`
 *   - the 89 photos voxelized into `src/toys/models.data.js`
 *
 * An entry carries only display metadata up front. The bricks themselves are
 * decoded by `load()` on first use and cached, so opening the app never expands
 * all 90 models.
 */

import { DUCK_MODEL } from './blueprint.js';
import { TOY_MODELS } from './toys/dataset.js';
import { planBuild, solutionBricks, modelCells } from './toys/model.js';

/**
 * Toy photos, resolved to URLs Vite can hash and copy into `dist/`.
 *
 * `assets/` is not Vite's `publicDir`, so a literal `/assets/toys/001.webp`
 * would work under `npm run dev` and 404 after `npm run build`. Eager globbing
 * materializes ~100 URL strings and no image bytes; the picker shows one
 * thumbnail at a time, so only that one is ever fetched.
 */
const TOY_IMAGES = import.meta.glob('../assets/toys/*.{webp,jpg,jpeg,png}', {
  eager: true,
  query: '?url',
  import: 'default'
});

const THUMBNAIL_BY_FILE = new Map(
  Object.entries(TOY_IMAGES).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url])
);

/**
 * Bricks are centered with `solutionBricks`' `-(width - 1) / 2`, which lands an
 * even-width model on half-integer coordinates while the baseplate studs sit on
 * integers. Shifting by half a cell on each even axis snaps the model back onto
 * the stud grid.
 */
function studOffset({ width, depth }) {
  return { dx: width % 2 === 0 ? 0.5 : 0, dz: depth % 2 === 0 ? 0.5 : 0 };
}

function snapToStuds(bricks, size) {
  const { dx, dz } = studOffset(size);
  if (dx === 0 && dz === 0) return bricks;
  return bricks.map((brick) => ({ ...brick, x: brick.x + dx, z: brick.z + dz }));
}

/**
 * One catalog entry. `load()` memoizes, so repeat selections of the same model
 * are free and the 724 KB dataset is decoded at most once per model.
 */
function createEntry({ id, name, group, model, solution, brickCount, cellCount, thumbnail }) {
  let cached = null;
  return {
    id,
    name,
    group,
    size: model.size,
    brickCount,
    cellCount,
    thumbnail,
    load() {
      if (!cached) {
        const plan = solution ?? planBuild(model);
        cached = {
          size: model.size,
          bricks: snapToStuds(solutionBricks(model, plan), model.size)
        };
      }
      return cached;
    }
  };
}

const DUCK_ENTRY = createEntry({
  id: 'duck',
  name: 'Duck',
  group: 'Classic',
  model: DUCK_MODEL,
  solution: null,
  brickCount: planBuild(DUCK_MODEL).length,
  cellCount: modelCells(DUCK_MODEL).length,
  thumbnail: null
});

const TOY_ENTRIES = TOY_MODELS.map((model) =>
  createEntry({
    id: model.id,
    // The dataset has no human-readable names — `note` is identical boilerplate
    // on all 89 records — so the id supplies the label and the photo supplies
    // the identity.
    name: `Toy ${model.id.replace('toy-', '')}`,
    group: model.target4?.difficulty ?? 'unsorted',
    model,
    solution: model.solution,
    brickCount: model.brickCount,
    cellCount: model.voxelCount,
    thumbnail: THUMBNAIL_BY_FILE.get(model.source) ?? null
  })
);

/** Every buildable model, duck first. */
export const BLUEPRINTS = [DUCK_ENTRY, ...TOY_ENTRIES];

export const DEFAULT_BLUEPRINT_ID = DUCK_ENTRY.id;

const BY_ID = new Map(BLUEPRINTS.map((entry) => [entry.id, entry]));

/** One catalog entry by id, falling back to the duck for an unknown id. */
export function getBlueprint(id) {
  return BY_ID.get(id) ?? DUCK_ENTRY;
}

/**
 * Catalog entries bucketed by `group`, in the order the picker should list
 * them: the duck first, then the toys easy → hard.
 */
export function blueprintGroups() {
  const order = ['Classic', 'easy', 'medium', 'hard', 'unsorted'];
  const groups = new Map(order.map((name) => [name, []]));
  for (const entry of BLUEPRINTS) {
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  }
  return [...groups].filter(([, entries]) => entries.length > 0);
}
