import { COLORS, SHAPES } from './brick.js';
import { PALETTE } from './freebuilder.js';

/**
 * Wires the HTML HUD to both builders and manages switching between the
 * "Guided" duck build and the "Free Build" sandbox. Returns `{ getMode }` so the
 * interaction layer (main.js) can route pointer / drag events to the right mode.
 */
export function createUI(guided, free) {
  const $ = (id) => document.getElementById(id);

  // ---- Mode switching ------------------------------------------------------
  let mode = 'guided';

  const el = {
    tabGuided: $('tab-guided'),
    tabFree: $('tab-free'),
    guidedPanel: $('guided-mode'),
    freePanel: $('free-mode'),
    hint: $('hud-hint'),

    // Guided
    progressLabel: $('progress-label'),
    progressPercent: $('progress-percent'),
    progressFill: $('progress-fill'),
    nextPanel: $('next-panel'),
    donePanel: $('done-panel'),
    swatch: $('next-swatch'),
    colorName: $('next-color-name'),
    btnPlace: $('btn-place'),
    btnUndo: $('btn-undo'),
    btnAuto: $('btn-auto'),
    btnPreview: $('btn-preview'),
    btnReset: $('btn-reset'),

    // Free
    palette: $('palette'),
    shapePicker: $('shape-picker'),
    freeCount: $('free-count'),
    freeSwatch: $('free-swatch'),
    freeColorName: $('free-color-name'),
    freeShapeName: $('free-shape-name'),
    btnFreeRotate: $('btn-free-rotate'),
    btnFreeUndo: $('btn-free-undo'),
    btnFreeReset: $('btn-free-reset'),
    btnGuide: $('btn-guide')
  };

  const HINTS = {
    guided: 'Click the glowing slot to place · Drag to orbit · Scroll to zoom',
    free: 'Drag a color or shape onto the board · R to rotate while dragging · Right-click to remove'
  };

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    const isGuided = mode === 'guided';
    el.guidedPanel.hidden = !isGuided;
    el.freePanel.hidden = isGuided;
    el.tabGuided.classList.toggle('is-active', isGuided);
    el.tabFree.classList.toggle('is-active', !isGuided);
    el.hint.textContent = HINTS[mode];
    guided.setActive(isGuided);
    free.setActive(!isGuided);
  }

  el.tabGuided.addEventListener('click', () => setMode('guided'));
  el.tabFree.addEventListener('click', () => setMode('free'));

  // ---- Guided panel --------------------------------------------------------
  guided.onChange((state) => {
    const pct = state.total ? Math.round((state.placed / state.total) * 100) : 0;
    el.progressLabel.textContent = `${state.placed} / ${state.total} bricks`;
    el.progressPercent.textContent = `${pct}%`;
    el.progressFill.style.width = `${pct}%`;

    if (state.done) {
      el.nextPanel.hidden = true;
      el.donePanel.hidden = false;
    } else {
      el.nextPanel.hidden = false;
      el.donePanel.hidden = true;
      el.swatch.style.background = state.nextColorHex ?? '#888';
      el.colorName.textContent = state.nextColorName ?? '—';
    }

    el.btnPlace.disabled = state.done;
    el.btnUndo.disabled = state.placed === 0;
    el.btnAuto.disabled = state.done;
    el.btnAuto.textContent = state.autoBuilding ? 'Stop Auto' : 'Auto-Build';
    el.btnAuto.classList.toggle('is-active', state.autoBuilding);
    el.btnPreview.textContent = state.previewOn ? 'Hide Preview' : 'Show Preview';
    el.btnPreview.classList.toggle('is-active', state.previewOn);
  });

  el.btnPlace.addEventListener('click', () => guided.placeNext());
  el.btnUndo.addEventListener('click', () => guided.undo());
  el.btnAuto.addEventListener('click', () => guided.toggleAutoBuild());
  el.btnPreview.addEventListener('click', () => guided.togglePreview());
  el.btnReset.addEventListener('click', () => guided.reset());

  // ---- Free panel: build the palette --------------------------------------
  for (const key of PALETTE) {
    const c = COLORS[key];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    btn.style.background = c.hex;
    btn.title = c.name;
    btn.dataset.color = key;

    btn.addEventListener('click', () => free.selectColor(key));
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      free.selectColor(key);
      free.beginDrag();
    });

    el.palette.appendChild(btn);
  }

  // ---- Free panel: build the shape picker ---------------------------------
  for (const shape of SHAPES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shape-btn';
    btn.title = `${shape.label} brick`;
    btn.dataset.shape = shape.id;

    const icon = document.createElement('span');
    icon.className = 'shape-icon';
    icon.style.gridTemplateColumns = `repeat(${shape.w}, 1fr)`;
    icon.style.gridTemplateRows = `repeat(${shape.d}, 1fr)`;
    for (let i = 0; i < shape.cells.length; i++) {
      const cell = document.createElement('span');
      cell.className = 'shape-cell';
      icon.appendChild(cell);
    }
    btn.appendChild(icon);

    btn.addEventListener('click', () => free.selectShape(shape.id));
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      free.selectShape(shape.id);
      free.beginDrag();
    });
    el.shapePicker.appendChild(btn);
  }

  free.onChange((state) => {
    el.freeCount.textContent = `${state.placed} brick${state.placed === 1 ? '' : 's'} placed`;
    el.freeSwatch.style.background = state.selectedHex ?? '#888';
    el.freeColorName.textContent = state.selectedName ?? '—';
    el.freeShapeName.textContent = state.shapeLabel ?? '—';
    for (const btn of el.palette.children) {
      btn.classList.toggle('is-selected', btn.dataset.color === state.selectedColor);
    }
    for (const btn of el.shapePicker.children) {
      const isSelected = btn.dataset.shape === state.selectedShape;
      btn.classList.toggle('is-selected', isSelected);
      // Tint the selected shape's cells to the chosen color; others stay neutral.
      const tint = isSelected ? state.selectedHex ?? '' : '';
      for (const cell of btn.querySelectorAll('.shape-cell')) {
        cell.style.backgroundColor = tint;
      }
    }
    el.btnFreeRotate.disabled = !state.canRotate;
    el.btnFreeUndo.disabled = state.placed === 0;
    el.btnFreeReset.disabled = state.placed === 0;
    el.btnGuide.textContent = state.guideOn ? 'Hide Duck Guide' : 'Show Duck Guide';
    el.btnGuide.classList.toggle('is-active', state.guideOn);
  });

  el.btnFreeRotate.addEventListener('click', () => free.rotate());
  el.btnFreeUndo.addEventListener('click', () => free.undo());
  el.btnFreeReset.addEventListener('click', () => free.reset());
  el.btnGuide.addEventListener('click', () => free.toggleGuide());

  // ---- Keyboard shortcuts --------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.code === 'KeyM') {
      setMode(mode === 'guided' ? 'free' : 'guided');
      return;
    }

    if (mode === 'guided') {
      switch (e.code) {
        case 'Space':
        case 'Enter':
          e.preventDefault();
          guided.placeNext();
          break;
        case 'KeyZ':
          guided.undo();
          break;
        case 'KeyA':
          guided.toggleAutoBuild();
          break;
        case 'KeyP':
          guided.togglePreview();
          break;
        case 'KeyR':
          guided.reset();
          break;
        default:
          break;
      }
      return;
    }

    // Free mode.
    switch (e.code) {
      case 'KeyZ':
        free.undo();
        break;
      case 'KeyR':
        free.rotate();
        break;
      case 'KeyG':
        free.toggleGuide();
        break;
      default: {
        const m = e.code.match(/^Digit([1-7])$/);
        if (m) {
          const key = PALETTE[Number(m[1]) - 1];
          if (key) free.selectColor(key);
        }
        break;
      }
    }
  });

  return { getMode: () => mode };
}
