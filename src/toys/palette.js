/**
 * Palette used by the toy voxel dataset.
 *
 * Every entry maps an ASCII layer character to a color key from `COLORS` in
 * `src/brick.js`, so a decoded toy model can be handed to the same brick
 * meshes as the authored duck blueprint. The RGB triples mirror the hex codes
 * in `src/brick.js` and are what the voxelizer quantizes photo pixels against
 * — keep the two lists in sync if a palette color ever changes.
 */

export const TOY_PALETTE = Object.freeze([
  { char: 'W', color: 'white', rgb: Object.freeze([247, 247, 242]) },
  { char: 'B', color: 'skyBlue', rgb: Object.freeze([91, 176, 230]) },
  { char: 'D', color: 'darkBlue', rgb: Object.freeze([47, 111, 176]) },
  { char: 'K', color: 'black', rgb: Object.freeze([32, 36, 44]) },
  { char: 'Y', color: 'yellow', rgb: Object.freeze([255, 207, 51]) },
  { char: 'R', color: 'red', rgb: Object.freeze([226, 59, 59]) },
  { char: 'P', color: 'pink', rgb: Object.freeze([247, 168, 191]) }
]);

/** Character used for an empty cell inside an ASCII layer row. */
export const EMPTY_CHAR = '.';

export const CHAR_TO_COLOR = Object.freeze(
  Object.fromEntries(TOY_PALETTE.map((entry) => [entry.char, entry.color]))
);

export const COLOR_TO_CHAR = Object.freeze(
  Object.fromEntries(TOY_PALETTE.map((entry) => [entry.color, entry.char]))
);

/** RGB → hue (degrees), chroma (0-1), lightness (0-1). */
function toCylindrical(r, g, b) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const chroma = max - min;
  let hue = 0;
  if (chroma > 0) {
    if (max === red) hue = ((green - blue) / chroma) % 6;
    else if (max === green) hue = (blue - red) / chroma + 2;
    else hue = (red - green) / chroma + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { hue, chroma, lightness: (max + min) / 2 };
}

const PALETTE_POINTS = TOY_PALETTE.map((entry) => ({ entry, ...toCylindrical(...entry.rgb) }));
const NEUTRAL_CHARS = new Set(['W', 'K']);
const CHROMATIC = PALETTE_POINTS.filter(({ entry }) => !NEUTRAL_CHARS.has(entry.char));
const WHITE = TOY_PALETTE.find((entry) => entry.char === 'W');
const BLACK = TOY_PALETTE.find((entry) => entry.char === 'K');

/** Shortest distance between two hues, in degrees. */
function hueDistance(a, b) {
  const delta = Math.abs(a - b) % 360;
  return delta > 180 ? 360 - delta : delta;
}

/**
 * Nearest palette entry for an RGB triple.
 *
 * Matching is hue-first rather than nearest-RGB. Plain RGB distance misreads
 * photo pixels badly against this seven-color palette: mid-grays land nearer to
 * a light pink than to the palette's near-white, and any darker chromatic pixel
 * collapses onto black. So a washed-out pixel is resolved as white or black by
 * lightness alone, and a colored pixel picks the closest hue, using lightness
 * only to separate same-hue pairs like sky blue from blue.
 *
 * The palette has no green, brown, or gray, so those photo colors land on their
 * nearest available hue — shape survives the mapping, exact color does not.
 */
export function quantize(r, g, b) {
  const { hue, chroma, lightness } = toCylindrical(r, g, b);
  if (chroma < 0.14) return lightness > 0.5 ? WHITE : BLACK;

  let best = CHROMATIC[0];
  let bestScore = Infinity;
  for (const candidate of CHROMATIC) {
    const score = hueDistance(hue, candidate.hue) + 90 * Math.abs(lightness - candidate.lightness);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best.entry;
}
