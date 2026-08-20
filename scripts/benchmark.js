import { TRAINING_DEFAULTS, trainDQN } from '../src/rl/trainer.js';

const episodes = Number(process.env.MINI_BRICK_EPISODES ?? TRAINING_DEFAULTS.episodes);

console.log(`Training the seeded Mini Brick DQN for ${episodes.toLocaleString()} episodes…`);
const result = await trainDQN({
  episodes,
  onProgress(progress) {
    if (progress.episode % 500 === 0 || progress.episode === episodes) {
      console.log(
        `episode ${progress.episode.toLocaleString()} · ` +
        `success ${(progress.rollingSuccess * 100).toFixed(0)}% · ` +
        `reward ${progress.rollingReward.toFixed(2)} · ` +
        `${(progress.elapsedMs / 1000).toFixed(1)}s`
      );
    }
  }
});

if (result.cancelled) {
  console.error('Benchmark was cancelled.');
  process.exitCode = 1;
} else {
  const { metrics } = result;
  console.log(JSON.stringify(metrics, null, 2));
  console.log(
    `Unseen tiers · easy ${(metrics.unseenByDifficulty.easy.successRate * 100).toFixed(1)}% · ` +
    `medium ${(metrics.unseenByDifficulty.medium.successRate * 100).toFixed(1)}% · ` +
    `hard ${(metrics.unseenByDifficulty.hard.successRate * 100).toFixed(1)}%`
  );
  result.agent.dispose();
  if (!metrics.pass) {
    console.error(
      `Benchmark failed: unseen ${(metrics.unseen.successRate * 100).toFixed(1)}%, ` +
      `random ${(metrics.random.successRate * 100).toFixed(1)}%.`
    );
    process.exitCode = 1;
  } else {
    console.log('Benchmark passed.');
  }
}
