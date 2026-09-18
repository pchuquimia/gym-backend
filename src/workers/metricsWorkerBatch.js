const positiveInteger = (value, fallback, minimum = 1) => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.floor(parsed))
    : fallback;
};

export const getMetricsBatchOptions = (env = process.env) => ({
  maxJobs: positiveInteger(env.METRICS_WORKER_BATCH_SIZE, 50),
  maxRuntimeMs: positiveInteger(
    env.METRICS_WORKER_MAX_RUNTIME_MS,
    8 * 60 * 1000,
    1000,
  ),
});

export const drainMetricJobs = async ({
  claimJob,
  processJob,
  maxJobs,
  maxRuntimeMs,
  now = Date.now,
}) => {
  const startedAt = now();
  const summary = {
    claimed: 0,
    completed: 0,
    failed: 0,
    reachedBatchLimit: false,
    reachedRuntimeLimit: false,
  };

  while (summary.claimed < maxJobs) {
    if (now() - startedAt >= maxRuntimeMs) {
      summary.reachedRuntimeLimit = true;
      break;
    }

    const job = await claimJob();
    if (!job) break;

    summary.claimed += 1;
    const result = await processJob(job);
    if (result?.ok === false) summary.failed += 1;
    else summary.completed += 1;
  }

  summary.reachedBatchLimit = summary.claimed >= maxJobs;
  summary.durationMs = Math.max(0, now() - startedAt);
  return summary;
};
