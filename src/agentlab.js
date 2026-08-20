import * as THREE from 'three';
import { createBrick, cellToWorld } from './brick.js';
import {
  DEFAULT_EXPERIMENT_SEED,
  createTargetDatasets,
  indexToVoxel
} from './rl/targets.js';
import { TRAINING_DEFAULTS } from './rl/config.js';

const CENTER_OFFSET = 1.5;

function targetLabel(target, index, total) {
  const difficulty = target?.difficulty
    ? ` · ${target.difficulty[0].toUpperCase()}${target.difficulty.slice(1)}`
    : '';
  return `Unseen target ${index + 1} of ${total}${difficulty}`;
}

/** Three.js presentation and worker orchestration for the Agent Lab mode. */
export class AgentLab {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.listeners = new Set();
    this.datasets = createTargetDatasets(DEFAULT_EXPERIMENT_SEED);
    this.unseenIndex = 0;
    this.requestId = 0;
    this.trained = false;
    this.playback = null;

    this.targetGroup = new THREE.Group();
    this.placedGroup = new THREE.Group();
    this.targetGroup.visible = false;
    this.placedGroup.visible = false;
    scene.add(this.targetGroup, this.placedGroup);

    this.targetGeometry = new THREE.BoxGeometry(0.88, 0.88, 0.88);
    this.targetMaterial = new THREE.MeshBasicMaterial({
      color: '#ffd23f',
      transparent: true,
      opacity: 0.2,
      depthWrite: false
    });
    this.targetMeshes = new Array(64).fill(null);
    this.placedMeshes = [];
    this.currentTarget = null;

    this.state = {
      status: 'idle',
      statusText: 'Ready to learn',
      episode: 0,
      totalEpisodes: TRAINING_DEFAULTS.episodes,
      epsilon: 1,
      rollingReward: 0,
      rollingSuccess: 0,
      loss: null,
      elapsedMs: 0,
      curve: [],
      metrics: null,
      trained: false,
      targetLabel: targetLabel(this.datasets.test[0], 0, this.datasets.test.length),
      playbackText: 'Target preview'
    };

    this.worker = new Worker(new URL('./rl/agent.worker.js', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (event) => this._onWorkerMessage(event.data));
    this.worker.addEventListener('error', (event) => {
      this._setState({ status: 'error', statusText: event.message || 'Training worker failed' });
    });

    this._showTarget(this.datasets.test[0]);
  }

  onChange(fn) {
    this.listeners.add(fn);
    fn(this.getState());
    return () => this.listeners.delete(fn);
  }

  getState() {
    return { ...this.state };
  }

  _setState(patch) {
    Object.assign(this.state, patch);
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }

  setActive(value) {
    this.active = value;
    this.targetGroup.visible = value;
    this.placedGroup.visible = value;
  }

  startTraining() {
    if (this.state.status === 'training' || this.state.status === 'evaluating') return;
    this.playback = null;
    this._clearPlaced();
    this.trained = false;
    this._setState({
      status: 'training',
      statusText: 'Exploring brick placements…',
      episode: 0,
      epsilon: 1,
      rollingReward: 0,
      rollingSuccess: 0,
      loss: null,
      elapsedMs: 0,
      curve: [],
      metrics: null,
      trained: false,
      playbackText: 'Waiting for the first validation run'
    });
    this.worker.postMessage({
      type: 'train',
      seed: DEFAULT_EXPERIMENT_SEED,
      episodes: TRAINING_DEFAULTS.episodes
    });
  }

  stopTraining() {
    if (this.state.status !== 'training' && this.state.status !== 'evaluating') return;
    this._setState({ status: 'stopping', statusText: 'Stopping after the current update…' });
    this.worker.postMessage({ type: 'cancel' });
  }

  runUnseen() {
    if (!this.trained) return false;
    const requestId = ++this.requestId;
    this._setState({ playbackText: 'Planning unseen target…' });
    this.worker.postMessage({
      type: 'rollout',
      split: 'unseen',
      index: this.unseenIndex,
      requestId
    });
    return true;
  }

  nextTarget() {
    this.unseenIndex = (this.unseenIndex + 1) % this.datasets.test.length;
    const target = this.datasets.test[this.unseenIndex];
    this._showTarget(target);
    this._clearPlaced();
    this._setState({
      targetLabel: targetLabel(target, this.unseenIndex, this.datasets.test.length),
      playbackText: this.trained ? 'Ready to run' : 'Target preview'
    });
    if (this.trained) this.runUnseen();
  }

  _onWorkerMessage(message) {
    if (message.type === 'progress') {
      const progress = message.progress;
      const point = {
        episode: progress.episode,
        success: progress.rollingSuccess,
        reward: progress.rollingReward
      };
      const curve = [...this.state.curve, point];
      const evaluating = progress.episode >= progress.totalEpisodes;
      this._setState({
        status: evaluating ? 'evaluating' : 'training',
        statusText: evaluating
          ? 'Evaluating seen and unseen targets…'
          : `Learning ${progress.difficulty ?? 'mixed'} targets…`,
        episode: progress.episode,
        totalEpisodes: progress.totalEpisodes,
        epsilon: progress.epsilon,
        rollingReward: progress.rollingReward,
        rollingSuccess: progress.rollingSuccess,
        loss: progress.loss,
        elapsedMs: progress.elapsedMs,
        curve
      });
      if (progress.playback) {
        this._beginPlayback(
          progress.playback.target,
          progress.playback.result,
          `Validation snapshot at episode ${progress.episode}`
        );
      }
      return;
    }

    if (message.type === 'complete') {
      this.trained = true;
      this._setState({
        status: 'complete',
        statusText: message.metrics.pass ? 'Generalization target passed' : 'Training complete — target not yet met',
        metrics: message.metrics,
        trained: true,
        elapsedMs: message.metrics.elapsedMs
      });
      this.runUnseen();
      return;
    }

    if (message.type === 'cancelled') {
      this._setState({
        status: 'cancelled',
        statusText: 'Training stopped',
        playbackText: 'Start a fresh run when ready'
      });
      return;
    }

    if (message.type === 'rollout') {
      if (message.requestId && message.requestId !== this.requestId) return;
      this.unseenIndex = message.index;
      this._beginPlayback(
        message.target,
        message.result,
        `Greedy policy · ${message.result.success ? 'exact build' : 'failed build'}`
      );
      this._setState({
        targetLabel: targetLabel(message.target, message.index, this.datasets.test.length)
      });
      return;
    }

    if (message.type === 'error') {
      this._setState({ status: 'error', statusText: message.message || 'Agent Lab error' });
    }
  }

  _showTarget(target) {
    this.targetGroup.clear();
    this.targetMeshes.fill(null);
    this.currentTarget = {
      ...target,
      voxels: Uint8Array.from(target.voxels)
    };

    for (let action = 0; action < this.currentTarget.voxels.length; action++) {
      if (!this.currentTarget.voxels[action]) continue;
      const { x, y, z } = indexToVoxel(action);
      const mesh = new THREE.Mesh(this.targetGeometry, this.targetMaterial);
      mesh.position.copy(cellToWorld(x - CENTER_OFFSET, y, z - CENTER_OFFSET));
      mesh.renderOrder = 1;
      this.targetMeshes[action] = mesh;
      this.targetGroup.add(mesh);
    }
  }

  _clearPlaced() {
    this.placedGroup.clear();
    this.placedMeshes = [];
    for (const mesh of this.targetMeshes) if (mesh) mesh.visible = true;
  }

  _beginPlayback(target, result, label) {
    this._showTarget(target);
    this._clearPlaced();
    this.playback = {
      actions: result.actions.slice(),
      result,
      cursor: 0,
      timer: 0,
      interval: this.state.status === 'training' ? 0.09 : 0.2
    };
    this._setState({ playbackText: label });
  }

  _placeAction(action) {
    const { x, y, z } = indexToVoxel(action);
    const correct = Boolean(this.currentTarget?.voxels[action]);
    const mesh = createBrick(
      x - CENTER_OFFSET,
      y,
      z - CENTER_OFFSET,
      correct ? 'skyBlue' : 'red'
    );
    this.placedGroup.add(mesh);
    this.placedMeshes.push(mesh);
    if (correct && this.targetMeshes[action]) this.targetMeshes[action].visible = false;
  }

  update(_elapsed, delta) {
    if (!this.active || !this.playback) return;
    this.playback.timer += delta;
    while (
      this.playback &&
      this.playback.timer >= this.playback.interval &&
      this.playback.cursor < this.playback.actions.length
    ) {
      this.playback.timer -= this.playback.interval;
      this._placeAction(this.playback.actions[this.playback.cursor++]);
    }
    if (this.playback.cursor >= this.playback.actions.length) this.playback = null;
  }

  destroy() {
    this.worker.terminate();
    this.targetGeometry.dispose();
    this.targetMaterial.dispose();
  }
}
