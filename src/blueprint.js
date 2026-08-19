/**
 * Duck blueprint — a simplified, recognizable Donald-Duck-style voxel figure.
 *
 * The model is authored layer-by-layer from the feet (y = 0) upward, so the
 * guided builder naturally stacks bricks bottom-to-top. Each layer is a small
 * ASCII grid where a character maps to a color:
 *
 *   .  empty        W white        B sky blue      D dark blue
 *   K  black        Y yellow       R red           P pink
 *
 * Within a layer, rows run FRONT (nearest the camera, +z) to BACK (-z), and
 * columns run LEFT (-x) to RIGHT (+x). Each layer is auto-centered on x/z.
 */

const CHAR = {
  W: 'white',
  B: 'skyBlue',
  D: 'darkBlue',
  K: 'black',
  Y: 'yellow',
  R: 'red',
  P: 'pink'
};

// Ordered list of layers, bottom (y = 0) first.
const LAYERS = [
  // y = 0 — yellow feet pointing forward + white body base behind them
  {
    y: 0,
    rows: [
      'YY.YY',
      'YY.YY',
      '.WWW.',
      '..W..',
      '.....'
    ]
  },
  // y = 1 — lower body (white) with sky-blue arm stubs at the sides
  {
    y: 1,
    rows: [
      '.WWW.',
      'BWWWB',
      '.WWW.'
    ]
  },
  // y = 2 — chest with red bow, arms continue
  {
    y: 2,
    rows: [
      '.WRW.',
      'BWWWB',
      '.WWW.'
    ]
  },
  // y = 3 — sailor collar (blue at the back) below the head
  {
    y: 3,
    rows: [
      '.WWW.',
      '.WWW.',
      '.BBB.'
    ]
  },
  // y = 4 — bottom of the big round head
  {
    y: 4,
    rows: [
      '.WWW.',
      'WWWWW',
      '.WWW.'
    ]
  },
  // y = 5 — head widens; yellow beak juts out the front
  {
    y: 5,
    rows: [
      '.YYY.',
      'WWWWW',
      'WWWWW',
      'WWWWW',
      '.WWW.'
    ]
  },
  // y = 6 — eyes (black) and pink cheeks
  {
    y: 6,
    rows: [
      '.KWK.',
      'PWWWP',
      'WWWWW',
      'WWWWW',
      '.WWW.'
    ]
  },
  // y = 7 — upper head, rounding inward
  {
    y: 7,
    rows: [
      '..W..',
      '.WWW.',
      'WWWWW',
      '.WWW.',
      '..W..'
    ]
  },
  // y = 8 — top of the head
  {
    y: 8,
    rows: [
      'WWW',
      'WWW',
      'WWW'
    ]
  },
  // y = 9 — sailor hat: black band at the front, blue crown
  {
    y: 9,
    rows: [
      'KKK',
      'BBB',
      'BBB'
    ]
  },
  // y = 10 — little hat knob on top
  {
    y: 10,
    rows: [
      '.B.',
      '.B.',
      '...'
    ]
  }
];

/**
 * Flattens the authored layers into an ordered array of brick descriptors:
 *   { x, y, z, color }
 * Order is bottom-up, and front-to-back / left-to-right within each layer.
 */
function buildBlueprint() {
  const bricks = [];
  for (const layer of LAYERS) {
    const rows = layer.rows;
    const height = rows.length;
    const width = Math.max(...rows.map((r) => r.length));
    const frontZ = (height - 1) / 2; // row 0 = front (largest z)
    const leftX = -(width - 1) / 2;  // col 0 = left (smallest x)

    for (let r = 0; r < height; r++) {
      const z = frontZ - r;
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const color = CHAR[row[c]];
        if (!color) continue;
        bricks.push({ x: leftX + c, y: layer.y, z, color });
      }
    }
  }
  return bricks;
}

export const DUCK_BLUEPRINT = buildBlueprint();
export const TOTAL_BRICKS = DUCK_BLUEPRINT.length;
