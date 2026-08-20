# Mini Bricks — DQN Agent Lab

A browser-only [Three.js](https://threejs.org/) brick builder with three modes:

- **Guided** — assemble the authored duck one piece at a time.
- **Free Build** — place colored, multi-cell bricks anywhere on the board.
- **Agent Lab** — train a Deep Q-Network live and watch it build voxel targets it never saw during training.

## Run

```bash
npm install
npm run dev
```

Open the printed URL (normally `http://localhost:5173`). No model checkpoint or
backend service is required. Agent Lab training starts only when **Train Agent**
is pressed and runs in a Web Worker so the 3D scene remains responsive.

## Agent Lab experiment

The experiment asks one narrow question: can a target-conditioned DQN learn to
construct stable voxel structures accurately and transfer that policy to new
structures from the same distribution?

### Environment

- Grid: monochrome 4×4×4 voxels.
- Observation: 64 target-occupancy values followed by 64 current-occupancy values.
- Actions: 64 discrete voxel positions, indexed as `x + 4*z + 16*y`.
- Action mask: occupied and physically unsupported positions only. It never
  reveals whether a voxel belongs to the target.
- Target generator: a connected 4×4 foundation plus difficulty-dependent tower
  voxels: easy has 2–4 extras, medium 5–10, and hard 11–16. This produces
  stable 18–32 voxel miniature skylines up to four layers tall.
- Reward: `+1` for a target voxel, another `+5` for exact completion, `-2`
  and termination for a supported off-target brick, `-0.25` for an invalid
  direct environment action, and a `-0.01` step cost.

The seeded dataset contains 512 training, 64 validation, and 100 held-out
targets, balanced across easy, medium, and hard structures. Voxel hashes are
unique across all three sets. “Unseen” therefore means a structure excluded
from training but drawn from the same stable 4×4×4 target generator; it does
not claim transfer to arbitrary sizes, colors, or the full duck.

### DQN

Training uses TensorFlow.js on the CPU inside a module worker. The online and
target networks combine a `128 → 256 ReLU → 256 ReLU → 64` global branch with
a shared per-voxel scoring branch. The local branch transfers placement rules
between coordinates while the global branch learns construction context. The
default run uses 30,000 episodes and a difficulty curriculum: easy targets first,
medium targets next, then predominantly hard targets, ending with a mixed
distribution to retain earlier skills. It also uses epsilon-greedy exploration,
replay memory, Huber loss, periodic target-network synchronization, and
partial-build curriculum states. Seen and unseen evaluation always starts from
an empty board.

After training, the app compares:

- Greedy performance on 100 seen training targets.
- Greedy performance on all 100 held-out targets.
- Separate greedy performance for easy, medium, and hard held-out targets.
- A seeded uniform-random policy on those same held-out targets.

The badge passes when unseen exact completion is at least **80%** and at least
**50 percentage points** above random. Coverage, placement precision, reward,
and run time remain visible even when the threshold is missed.

### Agent Lab controls

| Action | How |
| --- | --- |
| Train from scratch | **Train Agent** |
| Cancel safely | **Stop** |
| Replay current held-out target | **Run Unseen** |
| Select and run another held-out target | **Next Target** |
| Cycle app modes | `M` |
| Camera | Drag to orbit · scroll to zoom |

Training continues if another mode is selected. Agent Lab rendering and rollout
animation pause until its tab is visible again.

## Toy dataset — photos → voxels → bricks

`assets/toys/` holds 100 photos of mini-brick toys. `npm run voxelize` turns
each one into a voxel model plus an ordered brick-placement solution and writes
them all to `src/toys/models.data.js`, in the same layer-by-layer form
`src/blueprint.js` uses for the duck. The current run keeps **89 models**
(90,024 voxels, 24,429 bricks) and rejects 11 images that are packaging artwork
rather than an isolated toy.

### Pipeline

1. **Segment** — the near-white studio backdrop is estimated from a border
   frame; foreground is color distance plus Sobel edge energy, so white toys
   still register. The largest blob is kept and its holes filled, which drops
   watermarks, price tags, and background props.
2. **Sample** — the blob is rasterized into a grid at most 16 cells on its long
   side. A cell fills when half its pixels are foreground and takes the average
   pixel color, quantized to the seven palette colors in `src/brick.js`.
3. **Extrude** — one photo has no depth information, so depth is invented: every
   horizontal run of the silhouette is revolved about its own vertical axis, so
   a round head becomes a ball and a thin antenna stays thin. The model's front
   view always matches the photo.
4. **Support** — a cell is dropped underneath anything floating until it reaches
   the baseplate, giving the model the same support rule `VoxelEnvironment`
   enforces. About 30% of the stored voxels are support the photo did not ask
   for; `supportCount` records how many per model.
5. **Tile** — each layer is greedily packed into 1×1 … 2×4 bricks of one color,
   bottom-up, the same way guided auto-build merges neighbours.
6. **Downsample** — column heights are reduced to the 4×4×4 skyline the Agent
   Lab DQN trains on.

Every stored solution is re-validated on load in `tests/toys.test.js`: bricks
land in bounds, on empty cells, on top of something already placed, in the
model's color, and together cover the model exactly.

### Using the data

```js
import { toyBlueprint, toyBuildPlan, createToyTargetDatasets } from './src/toys/dataset.js';

toyBlueprint('toy-014');   // [{ x, y, z, color }] in build order — a DUCK_BLUEPRINT drop-in
toyBuildPlan('toy-014');   // the same build as bricks: shape id, rotation, footprint cells
createToyTargetDatasets(); // train / validation / unseen 4×4×4 targets for trainDQN({ datasets })
```

`trainDQN` still defaults to the seeded synthetic skylines; pass `datasets` to
train or evaluate on the toy targets instead. Difficulty tiers there are
terciles of voxel count *within the toy set*, and the 89 models collapse to 77
distinct 4×4×4 targets, deduplicated by hash before splitting.

### What the data is and is not

- The front silhouette and its colors are measured. Depth is a heuristic, and
  everything hidden behind the toy's front face is invented.
- The palette has no green, brown, or gray, so those photo colors land on the
  nearest available hue — shape survives quantization, exact color does not.
  Adding entries to `COLORS` in `src/brick.js` and `TOY_PALETTE` in
  `src/toys/palette.js` together would improve color fidelity.
- Support fill buries detail underneath large overhangs (a flower head fills the
  space down to its pot). That is the cost of a model that can actually be
  stacked bottom-up.

Regenerate at a different resolution or depth with
`node scripts/voxelize-toys.js --size 20 --depth-scale 0.8`, and add
`--preview <dir>` to write photo-vs-model comparison PNGs.


## Guided and Free Build controls

Guided mode supports placing the glowing next brick (`Space`), undo (`Z`),
auto-build (`A`), preview (`P`), and reset (`R`).

Free Build supports seven colors and the 1×1, 1×2, 1×3, 1×4, 2×2, 2×3, and
2×4 footprints. Drag a palette color or shape onto the board, rotate with `R`,
undo with `Z`, toggle the duck guide with `G`, and right-click a brick to remove it.

## Verification

```bash
npm test
npm run build
npm run benchmark
npm run voxelize   # regenerates src/toys/models.data.js from assets/toys/
```

The benchmark runs the complete seeded training and evaluation experiment and
returns a failing exit code if the generalization threshold is not met.

## Structure

- `src/rl/environment.js` — renderer-independent observation, mask, rewards, and transitions.
- `src/rl/targets.js` — seeded stable-target generator and disjoint datasets.
- `src/rl/dqn.js` / `trainer.js` — network, replay updates, rollouts, and metrics.
- `src/rl/agent.worker.js` — background training and rollout protocol.
- `src/agentlab.js` — Agent Lab scene state and playback.
- `src/builder.js` / `freebuilder.js` — existing Guided and Free Build modes.
- `src/toys/model.js` — toy layer format, brick tiling, and solution validation.
- `src/toys/palette.js` — photo-pixel → palette-color quantization.
- `src/toys/dataset.js` — blueprint and DQN-target accessors for the toy models.
- `src/toys/models.data.js` — generated toy models (do not edit by hand).
- `scripts/voxelize-toys.js` — image → voxel → brick-solution pipeline.
