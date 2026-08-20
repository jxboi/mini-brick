import { DQNAgent, epsilonAt, tf } from './dqn.js';
import { VoxelEnvironment } from './environment.js';
import { createRng, hashSeed, sampleIndex } from './random.js';
import { TRAINING_DEFAULTS } from './config.js';
import {
  DEFAULT_EXPERIMENT_SEED,
  createTargetDatasets,
  serializeTarget
} from './targets.js';

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export { TRAINING_DEFAULTS };

export function curriculumDifficultyWeights(progress) {
  if (progress < 0.2) return { easy: 1, medium: 0, hard: 0 };
  if (progress < 0.5) return { easy: 0.1, medium: 0.9, hard: 0 };
  if (progress < 0.8) return { easy: 0, medium: 0.15, hard: 0.85 };
  return { easy: 0.1, medium: 0.2, hard: 0.7 };
}

function sampleCurriculumTarget(datasets, rng, episode, totalEpisodes) {
  const progress = episode / Math.max(1, totalEpisodes);
  const weights = curriculumDifficultyWeights(progress);
  const roll = rng();
  const difficulty = roll < weights.easy
    ? 'easy'
    : roll < weights.easy + weights.medium
      ? 'medium'
      : 'hard';
  const pool = datasets.trainByDifficulty[difficulty];
  return pool[sampleIndex(rng, pool.length)];
}

export async function rollout(agent, target, { rng = Math.random, randomPolicy = false } = {}) {
  const environment = new VoxelEnvironment();
  let state = environment.reset(target);
  let totalReward = 0;
  const actions = [];
  let finalInfo = environment.info({ reason: 'building', success: false });

  while (!environment.done) {
    const mask = environment.validActionMask();
    const action = randomPolicy
      ? agent.selectAction(state, mask, 1, rng)
      : agent.selectAction(state, mask, 0, rng);
    if (action < 0) break;
    const transition = environment.step(action);
    actions.push(action);
    totalReward += transition.reward;
    state = transition.observation;
    finalInfo = transition.info;
  }

  return {
    targetId: target.id,
    actions,
    success: Boolean(finalInfo.success),
    reason: finalInfo.reason,
    coverage: finalInfo.coverage,
    precision: finalInfo.precision,
    reward: totalReward,
    placedCount: finalInfo.placedCount,
    targetCount: finalInfo.targetCount,
    steps: finalInfo.steps
  };
}

function randomAgent() {
  return {
    selectAction(_state, mask, _epsilon, rng) {
      const valid = [];
      for (let i = 0; i < mask.length; i++) if (mask[i]) valid.push(i);
      return valid.length ? valid[Math.floor(rng() * valid.length)] : -1;
    }
  };
}

async function evaluateResults(agent, targets, { seed, randomPolicy = false } = {}) {
  const rng = createRng(seed ?? 'evaluation');
  const policy = randomPolicy ? randomAgent() : agent;
  const results = [];
  for (const target of targets) {
    results.push(await rollout(policy, target, { rng, randomPolicy }));
  }
  return results;
}

function summarizeResults(results) {
  const completed = results.filter((result) => result.success);
  return {
    successRate: mean(results.map((result) => Number(result.success))),
    averageCoverage: mean(results.map((result) => result.coverage)),
    placementPrecision: mean(results.map((result) => result.precision)),
    averageReward: mean(results.map((result) => result.reward)),
    averageActionsCompleted: mean(completed.map((result) => result.steps)),
    completed: completed.length,
    total: results.length
  };
}

export async function evaluate(agent, targets, options = {}) {
  return summarizeResults(await evaluateResults(agent, targets, options));
}

function recentStats(history, width = 100) {
  const recent = history.slice(-width);
  return {
    rollingReward: mean(recent.map((item) => item.reward)),
    rollingSuccess: mean(recent.map((item) => Number(item.success)))
  };
}

/**
 * Start some training trials from a valid partial target. This exposes the DQN
 * to late-construction decisions before it can complete a whole structure from
 * scratch. Evaluation never uses this curriculum.
 */
function applyStateCurriculum(environment, target, rng, episode, totalEpisodes) {
  const progress = episode / Math.max(1, totalEpisodes);
  const usePartialStart = progress < 0.35
    ? episode % 4 !== 0
    : progress < 0.7
      ? episode % 2 === 0
      : episode % 5 === 0;
  if (!usePartialStart) return environment.observation();

  const minimumFraction = progress < 0.35 ? 0.7 : progress < 0.7 ? 0.4 : 0.25;
  const minimum = Math.min(target.count - 1, Math.floor(target.count * minimumFraction));
  const desired = minimum + Math.floor(rng() * Math.max(1, target.count - minimum));

  for (let placed = 0; placed < desired; placed++) {
    const mask = environment.validActionMask();
    const correctFrontier = [];
    for (let action = 0; action < mask.length; action++) {
      if (mask[action] && target.voxels[action]) correctFrontier.push(action);
    }
    if (correctFrontier.length === 0) break;
    environment.step(correctFrontier[Math.floor(rng() * correctFrontier.length)]);
  }

  // The curriculum creates the starting state rather than consuming the trial
  // budget or reward. Correct occupancy remains in place.
  environment.steps = 0;
  return environment.observation();
}

export async function trainDQN({
  seed = DEFAULT_EXPERIMENT_SEED,
  episodes = TRAINING_DEFAULTS.episodes,
  onProgress = () => {},
  cancellation = { cancelled: false },
  agent: providedAgent = null
} = {}) {
  await tf.setBackend('cpu');
  await tf.ready();

  const startedAt = performance.now();
  const datasets = createTargetDatasets(seed);
  const rng = createRng(`${seed}:training`);
  const agent = providedAgent ?? new DQNAgent({
    seed: hashSeed(seed),
    replayCapacity: TRAINING_DEFAULTS.replayCapacity,
    batchSize: TRAINING_DEFAULTS.batchSize,
    gamma: TRAINING_DEFAULTS.gamma,
    learningRate: TRAINING_DEFAULTS.learningRate
  });
  const environment = new VoxelEnvironment();
  const history = [];
  const epsilonDecayEpisodes = Math.min(
    TRAINING_DEFAULTS.epsilonDecayEpisodes,
    Math.max(1, Math.floor(episodes * 0.8))
  );
  let environmentSteps = 0;
  let lastLoss = null;

  for (let episode = 1; episode <= episodes; episode++) {
    if (cancellation.cancelled) {
      return { cancelled: true, agent, datasets, history };
    }

    const target = sampleCurriculumTarget(datasets, rng, episode, episodes);
    environment.reset(target);
    let state = applyStateCurriculum(environment, target, rng, episode, episodes);
    const epsilon = epsilonAt(episode - 1, epsilonDecayEpisodes);
    let episodeReward = 0;
    let finalInfo = environment.info({ success: false, reason: 'building' });

    while (!environment.done) {
      const mask = environment.validActionMask();
      const action = agent.selectAction(state, mask, epsilon, rng);
      if (action < 0) break;
      const result = environment.step(action);
      const nextMask = environment.validActionMask();
      agent.remember({
        state,
        action,
        reward: result.reward,
        nextState: result.observation,
        nextMask,
        done: result.done
      });
      state = result.observation;
      finalInfo = result.info;
      episodeReward += result.reward;
      environmentSteps++;

      if (
        agent.replay.length >= TRAINING_DEFAULTS.warmup &&
        environmentSteps % TRAINING_DEFAULTS.trainEverySteps === 0
      ) {
        lastLoss = await agent.trainBatch(rng);
        if (agent.optimizerSteps % TRAINING_DEFAULTS.targetSyncEvery === 0) agent.syncTarget();
      }
    }

    history.push({ reward: episodeReward, success: Boolean(finalInfo.success) });

    if (episode % TRAINING_DEFAULTS.progressEvery === 0 || episode === episodes) {
      const stats = recentStats(history);
      const progress = {
        episode,
        totalEpisodes: episodes,
        epsilon,
        loss: lastLoss,
        difficulty: target.difficulty,
        elapsedMs: performance.now() - startedAt,
        ...stats
      };

      if (episode % TRAINING_DEFAULTS.validationPlaybackEvery === 0) {
        const targetIndex = (episode / TRAINING_DEFAULTS.validationPlaybackEvery - 1) %
          datasets.validation.length;
        const target = datasets.validation[targetIndex];
        progress.playback = {
          target: serializeTarget(target),
          result: await rollout(agent, target, { rng })
        };
      }

      onProgress(progress);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const seen = await evaluate(agent, datasets.train.slice(0, 100), { seed: `${seed}:seen` });
  const unseenByDifficulty = {};
  const unseenResults = [];
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const results = await evaluateResults(agent, datasets.testByDifficulty[difficulty], {
      seed: `${seed}:unseen:${difficulty}`
    });
    unseenByDifficulty[difficulty] = summarizeResults(results);
    unseenResults.push(...results);
  }
  const unseen = summarizeResults(unseenResults);
  const random = await evaluate(agent, datasets.test, {
    seed: `${seed}:random`,
    randomPolicy: true
  });
  const threshold = 0.8;
  const baselineMargin = 0.5;
  const metrics = {
    seen,
    unseen,
    unseenByDifficulty,
    random,
    threshold,
    baselineMargin,
    pass: unseen.successRate >= threshold &&
      unseen.successRate - random.successRate >= baselineMargin,
    elapsedMs: performance.now() - startedAt,
    episodes
  };

  return { cancelled: false, agent, datasets, history, metrics };
}
