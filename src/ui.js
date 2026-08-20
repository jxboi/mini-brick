import { COLORS, SHAPES } from './brick.js';
import { PALETTE } from './freebuilder.js';

/**
 * Wires the HTML HUD to all three modes. Returns `{ getMode }` so the
 * interaction layer (main.js) can route pointer / drag events to the right mode.
 */
export function createUI(guided, free, agent) {
  const $ = (id) => document.getElementById(id);

  // ---- Mode switching ------------------------------------------------------
  let mode = 'guided';

  const el = {
    tabGuided: $('tab-guided'),
    tabFree: $('tab-free'),
    tabAgent: $('tab-agent'),
    guidedPanel: $('guided-mode'),
    freePanel: $('free-mode'),
    agentPanel: $('agent-mode'),
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
    btnGuide: $('btn-guide'),

    // Agent Lab
    agentStatus: $('agent-status'),
    agentStatusDot: $('agent-status-dot'),
    agentEpisode: $('agent-episode'),
    agentProgressPercent: $('agent-progress-percent'),
    agentProgressFill: $('agent-progress-fill'),
    agentEpsilon: $('agent-epsilon'),
    agentReward: $('agent-reward'),
    agentSuccess: $('agent-success'),
    agentChart: $('agent-chart'),
    agentResults: $('agent-results'),
    agentVerdict: $('agent-verdict'),
    agentSeen: $('agent-seen'),
    agentUnseen: $('agent-unseen'),
    agentRandom: $('agent-random'),
    agentUnseenEasy: $('agent-unseen-easy'),
    agentUnseenMedium: $('agent-unseen-medium'),
    agentUnseenHard: $('agent-unseen-hard'),
    agentResultDetail: $('agent-result-detail'),
    agentTargetLabel: $('agent-target-label'),
    agentPlaybackText: $('agent-playback-text'),
    btnAgentTrain: $('btn-agent-train'),
    btnAgentStop: $('btn-agent-stop'),
    btnAgentRun: $('btn-agent-run'),
    btnAgentNext: $('btn-agent-next')
  };

  const HINTS = {
    guided: 'Click the glowing slot to place · Drag to orbit · Scroll to zoom',
    free: 'Drag a color or shape onto the board · R to rotate while dragging · Right-click to remove',
    agent: 'Train live in your browser · Watch the DQN build targets it never trained on'
  };

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    const isGuided = mode === 'guided';
    const isFree = mode === 'free';
    const isAgent = mode === 'agent';
    el.guidedPanel.hidden = !isGuided;
    el.freePanel.hidden = !isFree;
    el.agentPanel.hidden = !isAgent;
    el.tabGuided.classList.toggle('is-active', isGuided);
    el.tabFree.classList.toggle('is-active', isFree);
    el.tabAgent.classList.toggle('is-active', isAgent);
    el.hint.textContent = HINTS[mode];
    guided.setActive(isGuided);
    free.setActive(isFree);
    agent.setActive(isAgent);
  }

  el.tabGuided.addEventListener('click', () => setMode('guided'));
  el.tabFree.addEventListener('click', () => setMode('free'));
  el.tabAgent.addEventListener('click', () => setMode('agent'));

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

  // ---- Agent Lab panel -----------------------------------------------------
  function percent(value) {
    return `${Math.round((value ?? 0) * 100)}%`;
  }

  function drawLearningCurve(points) {
    const canvas = el.agentChart;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const pad = 9;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = pad + ((height - pad * 2) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();
    }
    if (points.length < 2) return;

    const rewards = points.map((point) => point.reward);
    const rewardMin = Math.min(...rewards);
    const rewardMax = Math.max(...rewards);
    const xFor = (index) => pad + (index / (points.length - 1)) * (width - pad * 2);

    function line(color, valueFor) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      points.forEach((point, index) => {
        const normalized = Math.min(1, Math.max(0, valueFor(point)));
        const x = xFor(index);
        const y = height - pad - normalized * (height - pad * 2);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    line('#ffd23f', (point) => point.success);
    line('#4ea8de', (point) =>
      rewardMax === rewardMin ? 0.5 : (point.reward - rewardMin) / (rewardMax - rewardMin)
    );
  }

  agent.onChange((state) => {
    const progress = state.totalEpisodes ? state.episode / state.totalEpisodes : 0;
    const busy = ['training', 'evaluating', 'stopping'].includes(state.status);
    el.agentStatus.textContent = state.statusText;
    el.agentStatusDot.dataset.status = state.status;
    el.agentEpisode.textContent = `Episode ${state.episode.toLocaleString()} / ${state.totalEpisodes.toLocaleString()}`;
    el.agentProgressPercent.textContent = percent(progress);
    el.agentProgressFill.style.width = percent(progress);
    el.agentEpsilon.textContent = state.epsilon.toFixed(2);
    el.agentReward.textContent = state.rollingReward.toFixed(2);
    el.agentSuccess.textContent = percent(state.rollingSuccess);
    el.agentTargetLabel.textContent = state.targetLabel;
    el.agentPlaybackText.textContent = state.playbackText;
    el.btnAgentTrain.disabled = busy;
    el.btnAgentTrain.textContent = state.trained ? 'Train Again' : 'Train Agent';
    el.btnAgentStop.disabled = !busy || state.status === 'stopping';
    el.btnAgentRun.disabled = !state.trained;
    drawLearningCurve(state.curve);

    const metrics = state.metrics;
    el.agentResults.hidden = !metrics;
    if (metrics) {
      el.agentVerdict.textContent = metrics.pass ? 'PASS · Generalizes' : 'NEEDS MORE TRAINING';
      el.agentVerdict.classList.toggle('is-pass', metrics.pass);
      el.agentVerdict.classList.toggle('is-fail', !metrics.pass);
      el.agentSeen.textContent = percent(metrics.seen.successRate);
      el.agentUnseen.textContent = percent(metrics.unseen.successRate);
      el.agentRandom.textContent = percent(metrics.random.successRate);
      el.agentUnseenEasy.textContent = percent(metrics.unseenByDifficulty.easy.successRate);
      el.agentUnseenMedium.textContent = percent(metrics.unseenByDifficulty.medium.successRate);
      el.agentUnseenHard.textContent = percent(metrics.unseenByDifficulty.hard.successRate);
      el.agentResultDetail.textContent =
        `${percent(metrics.unseen.averageCoverage)} unseen coverage · ` +
        `${percent(metrics.unseen.placementPrecision)} placement precision · ` +
        `${(metrics.elapsedMs / 1000).toFixed(1)}s`;
    }
  });

  el.btnAgentTrain.addEventListener('click', () => agent.startTraining());
  el.btnAgentStop.addEventListener('click', () => agent.stopTraining());
  el.btnAgentRun.addEventListener('click', () => agent.runUnseen());
  el.btnAgentNext.addEventListener('click', () => agent.nextTarget());

  // ---- Keyboard shortcuts --------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.code === 'KeyM') {
      const modes = ['guided', 'free', 'agent'];
      setMode(modes[(modes.indexOf(mode) + 1) % modes.length]);
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

    if (mode !== 'free') return;

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
