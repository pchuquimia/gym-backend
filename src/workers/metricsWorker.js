import { loadBackendEnvironment } from "../config/loadEnv.js";

loadBackendEnvironment();

const [{ connectDB }, { default: MetricRefreshJob }, metricsService] =
  await Promise.all([
    import("../config/db.js"),
    import("../models/MetricRefreshJob.js"),
    import("../services/athleteMetricsService.js"),
  ]);

const POLL_INTERVAL_MS = Math.max(
  500,
  Number(process.env.METRICS_WORKER_POLL_MS || 2000),
);
const MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.METRICS_WORKER_MAX_ATTEMPTS || 3),
);
const DAY_MS = 24 * 60 * 60 * 1000;
let stopping = false;
const runOnce = process.argv.includes("--once");

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const claimJob = () =>
  MetricRefreshJob.findOneAndUpdate(
    {
      attempts: { $lt: MAX_ATTEMPTS },
      $or: [
        {
          status: { $in: ["pending", "failed"] },
          nextRunAt: { $lte: new Date() },
        },
        {
          status: "running",
          lockedAt: { $lte: new Date(Date.now() - 10 * 60 * 1000) },
        },
      ],
    },
    {
      $set: { status: "running", lockedAt: new Date() },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { createdAt: 1 } },
  ).lean();

const processJob = async (job) => {
  try {
    await metricsService.rebuildAthleteMetrics({
      ownerId: job.ownerId,
      dateKey: job.dateKey,
      today: new Date().toISOString().slice(0, 10),
    });
    await MetricRefreshJob.findByIdAndUpdate(job._id, {
      $set: {
        status: "complete",
        completedAt: new Date(),
        lockedAt: null,
        expiresAt: new Date(Date.now() + 7 * DAY_MS),
      },
    });
  } catch (error) {
    const exhausted = job.attempts >= MAX_ATTEMPTS;
    await MetricRefreshJob.findByIdAndUpdate(job._id, {
      $set: {
        status: "failed",
        lockedAt: null,
        lastError: String(error.message || error).slice(0, 500),
        nextRunAt: new Date(Date.now() + (exhausted ? DAY_MS : 15_000)),
        expiresAt: exhausted ? new Date(Date.now() + 7 * DAY_MS) : null,
      },
    });
  }
};

const shutdown = () => {
  stopping = true;
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await connectDB(process.env.MONGO_URI || "mongodb://localhost:27017/gym");
console.log("Worker de metricas iniciado");
while (!stopping) {
  const job = await claimJob();
  if (job) await processJob(job);
  if (runOnce) break;
  if (!job) await wait(POLL_INTERVAL_MS);
}
process.exit(0);
