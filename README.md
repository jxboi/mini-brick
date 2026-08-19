# Mini Bricks — Guided Duck Builder

A small [three.js](https://threejs.org/) environment where you assemble a
Donald-Duck-style figure out of colored mini bricks, **one piece at a time**.
A glowing "ghost" slot shows where the next brick goes; place bricks bottom-up
until the duck is complete.

## Run

```bash
npm install
npm run dev
```

Then open the printed URL (default `http://localhost:5173`).

## Controls

### Guided mode

| Action        | How                                            |
| ------------- | ---------------------------------------------- |
| Place brick   | Click the glowing slot · **Place Next** · `Space` |
| Undo          | **Undo** button · `Z`                          |
| Auto-build    | **Auto-Build** button · `A`                    |
| Toggle target | **Show/Hide Preview** · `P`                     |
| Reset         | **Reset** button · `R`                          |
| Camera        | Drag to orbit · scroll to zoom                 |

Switch modes with the **Guided** / **Free Build** tabs or the `M` key.

### Free Build mode

Pick a color and a brick shape, then drag a color swatch onto the board to place
it. Shapes come in several rectangular footprints — **1×1, 1×2, 1×3, 1×4, 2×2,
2×3, 2×4** — and non-square bricks can be rotated before placing.

| Action        | How                                            |
| ------------- | ---------------------------------------------- |
| Pick color    | Click a swatch · `1`–`7`                        |
| Pick shape    | Click a shape button                           |
| Place brick   | Drag a color swatch or shape button onto the board |
| Rotate brick  | **Rotate** button · `R` (also works mid-drag)  |
| Remove brick  | Right-click a placed brick                      |
| Undo          | **Undo** button · `Z`                          |
| Reset         | **Reset** button                                |
| Duck guide    | **Show/Hide Duck Guide** · `G`                  |
| Camera        | Drag to orbit · scroll to zoom                 |

The selected shape's icon is tinted with the currently selected color.

## How it works

- `src/scene.js` — renderer, lights, camera, `OrbitControls`, studded baseplate.
- `src/brick.js` — color palette + brick shapes and studded/ghost geometry.
- `src/blueprint.js` — the duck authored as ordered voxel layers (feet → hat).
- `src/builder.js` — guided build state machine: ghost placement, undo, reset,
  auto-build, target preview, and progress events.
- `src/freebuilder.js` — free-build sandbox: color/shape selection, rotation,
  multi-cell placement, occupancy, and the optional duck guide overlay.
- `src/ui.js` — HUD wiring (progress, next color, buttons, keyboard).
- `src/main.js` — bootstraps everything and handles click-to-place.

## Customize the model

Edit the `LAYERS` array in [`src/blueprint.js`](src/blueprint.js). Each layer is
a small ASCII grid; a character maps to a color (`W` white, `B` sky blue,
`K` black, `Y` yellow, `R` red, `P` pink, `D` dark blue, `.` empty). Rows run
front→back, columns left→right, and layers stack from the bottom up.
