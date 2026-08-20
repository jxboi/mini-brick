import { trainDQN, rollout } from './trainer.js';
import { DEFAULT_EXPERIMENT_SEED, serializeTarget } from './targets.js';
import { createRng } from './random.js';

let activeRun = 0;
let cancellation = null;
let trained = null;

function send(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

self.addEventListener('message', async (event) => {
  const message = event.data ?? {};

  if (message.type === 'cancel') {
    if (cancellation) cancellation.cancelled = true;
    return;
  }

  if (message.type === 'train') {
    const runId = ++activeRun;
    if (cancellation) cancellation.cancelled = true;
    cancellation = { cancelled: false };
    if (trained?.agent) trained.agent.dispose();
    trained = null;

    try {
      const result = await trainDQN({
        seed: message.seed ?? DEFAULT_EXPERIMENT_SEED,
        episodes: message.episodes,
        cancellation,
        onProgress: (progress) => {
          if (runId === activeRun) send('progress', { runId, progress });
        }
      });
      if (runId !== activeRun) return;
      if (result.cancelled) {
        trained = result;
        send('cancelled', { runId });
      } else {
        trained = result;
        send('complete', { runId, metrics: result.metrics });
      }
    } catch (error) {
      send('error', { runId, message: error?.message ?? String(error) });
    }
    return;
  }

  if (message.type === 'rollout') {
    if (!trained?.agent || trained.cancelled) {
      send('error', { message: 'Train the agent before requesting a rollout.' });
      return;
    }
    const split = message.split === 'seen' ? trained.datasets.train : trained.datasets.test;
    const index = ((message.index ?? 0) % split.length + split.length) % split.length;
    const target = split[index];
    const result = await rollout(trained.agent, target, {
      rng: createRng(`${DEFAULT_EXPERIMENT_SEED}:rollout:${target.id}`)
    });
    send('rollout', {
      requestId: message.requestId,
      index,
      target: serializeTarget(target),
      result
    });
  }
});
