export const TRAINING_DEFAULTS = Object.freeze({
  episodes: 30000,
  replayCapacity: 75000,
  warmup: 512,
  batchSize: 64,
  gamma: 0.99,
  learningRate: 0.0005,
  trainEverySteps: 48,
  targetSyncEvery: 500,
  epsilonDecayEpisodes: 12000,
  progressEvery: 100,
  validationPlaybackEvery: 3000
});
