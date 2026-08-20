import * as tf from '@tensorflow/tfjs';
import { ReplayBuffer } from './replay.js';
import { VOXEL_COUNT } from './targets.js';

export const OBSERVATION_SIZE = VOXEL_COUNT * 2;

export function epsilonAt(episode, decayEpisodes = 12000, start = 1, end = 0.05) {
  const progress = Math.min(1, Math.max(0, episode / decayEpisodes));
  return start + (end - start) * progress;
}

export function maskedArgMax(values, mask) {
  let bestIndex = -1;
  let bestValue = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (!mask[i]) continue;
    if (values[i] > bestValue) {
      bestValue = values[i];
      bestIndex = i;
    }
  }
  return bestIndex;
}

export function maskedMax(values, mask) {
  const index = maskedArgMax(values, mask);
  return index < 0 ? 0 : values[index];
}

function initializer(seed) {
  return tf.initializers.glorotUniform({ seed });
}

export function createQNetwork(seed = 1, learningRate = 0.001) {
  const input = tf.input({ shape: [VOXEL_COUNT, 2] });

  // A global branch learns construction order and whole-structure context.
  const flattened = tf.layers.flatten().apply(input);
  const globalHiddenOne = tf.layers.dense({
    units: 256,
    activation: 'relu',
    kernelInitializer: initializer(seed)
  }).apply(flattened);
  const globalHiddenTwo = tf.layers.dense({
    units: 256,
    activation: 'relu',
    kernelInitializer: initializer(seed + 1)
  }).apply(globalHiddenOne);
  const globalQ = tf.layers.dense({
    units: VOXEL_COUNT,
    activation: 'linear',
    kernelInitializer: initializer(seed + 2)
  }).apply(globalHiddenTwo);

  // A shared per-voxel branch preserves the correspondence between each
  // target/current occupancy pair and its action. Sharing weights lets a rule
  // learned at one coordinate transfer to every other coordinate.
  const localQGrid = tf.layers.conv1d({
    filters: 1,
    kernelSize: 1,
    activation: 'linear',
    kernelInitializer: initializer(seed + 3)
  }).apply(input);
  const localQ = tf.layers.flatten().apply(localQGrid);
  const output = tf.layers.add().apply([globalQ, localQ]);
  const model = tf.model({ inputs: input, outputs: output });
  model.compile({
    optimizer: tf.train.adam(learningRate),
    loss: (labels, predictions) => tf.losses.huberLoss(labels, predictions)
  });
  return model;
}

function stateTensor(states) {
  const items = Array.isArray(states) ? states : [states];
  const packed = new Float32Array(items.length * OBSERVATION_SIZE);
  for (let batch = 0; batch < items.length; batch++) {
    const state = items[batch];
    const offset = batch * OBSERVATION_SIZE;
    for (let action = 0; action < VOXEL_COUNT; action++) {
      packed[offset + action * 2] = state[action];
      packed[offset + action * 2 + 1] = state[VOXEL_COUNT + action];
    }
  }
  return tf.tensor3d(packed, [items.length, VOXEL_COUNT, 2]);
}

function batchTensor(items, field) {
  return stateTensor(items.map((item) => item[field]));
}

export class DQNAgent {
  constructor({
    seed = 1,
    replayCapacity = 20000,
    batchSize = 64,
    gamma = 0.95,
    learningRate = 0.001
  } = {}) {
    this.batchSize = batchSize;
    this.gamma = gamma;
    this.online = createQNetwork(seed, learningRate);
    this.target = createQNetwork(seed + 1000, learningRate);
    this.replay = new ReplayBuffer(replayCapacity);
    this.optimizerSteps = 0;
    this.syncTarget();
  }

  qValues(state) {
    return tf.tidy(() => {
      const input = stateTensor(state);
      return Float32Array.from(this.online.predict(input).dataSync());
    });
  }

  selectAction(state, mask, epsilon, rng) {
    const valid = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) valid.push(i);
    if (valid.length === 0) return -1;
    if (rng() < epsilon) return valid[Math.floor(rng() * valid.length)];
    return maskedArgMax(this.qValues(state), mask);
  }

  remember(transition) {
    this.replay.push(transition);
  }

  async trainBatch(rng) {
    if (this.replay.length < this.batchSize) return null;
    const batch = this.replay.sample(this.batchSize, rng);
    const states = batchTensor(batch, 'state');
    const nextStates = batchTensor(batch, 'nextState');
    const currentPredictions = this.online.predict(states);
    const nextPredictions = this.target.predict(nextStates);
    const targets = currentPredictions.arraySync();
    const nextValues = nextPredictions.arraySync();

    for (let i = 0; i < batch.length; i++) {
      const transition = batch[i];
      const future = transition.done ? 0 : maskedMax(nextValues[i], transition.nextMask);
      targets[i][transition.action] = transition.reward + this.gamma * future;
    }

    const targetTensor = tf.tensor2d(targets, [batch.length, VOXEL_COUNT]);
    const loss = await this.online.trainOnBatch(states, targetTensor);

    states.dispose();
    nextStates.dispose();
    currentPredictions.dispose();
    nextPredictions.dispose();
    targetTensor.dispose();
    this.optimizerSteps++;
    return Array.isArray(loss) ? loss[0] : loss;
  }

  syncTarget() {
    const source = this.online.getWeights();
    // LayersModel#getWeights may expose live LayerVariables. setWeights copies
    // their values into the target model, so the source tensors must not be
    // disposed here or the online network becomes unusable.
    this.target.setWeights(source);
  }

  dispose() {
    this.online.dispose();
    this.target.dispose();
    this.replay.clear();
  }
}

export { tf };
