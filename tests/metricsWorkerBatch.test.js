import { jest } from "@jest/globals";
import {
  drainMetricJobs,
  getMetricsBatchOptions,
} from "../src/workers/metricsWorkerBatch.js";

describe("metrics worker batch", () => {
  test("procesa trabajos hasta vaciar la cola", async () => {
    const jobs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const processJob = jest.fn(async () => ({ ok: true }));
    const summary = await drainMetricJobs({
      claimJob: async () => jobs.shift() || null,
      processJob,
      maxJobs: 50,
      maxRuntimeMs: 60_000,
    });

    expect(processJob).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({
      claimed: 3,
      completed: 3,
      failed: 0,
      reachedBatchLimit: false,
      reachedRuntimeLimit: false,
    });
  });

  test("respeta el limite de trabajos", async () => {
    const claimJob = jest.fn(async () => ({ id: "pending" }));
    const summary = await drainMetricJobs({
      claimJob,
      processJob: async () => ({ ok: true }),
      maxJobs: 2,
      maxRuntimeMs: 60_000,
    });

    expect(claimJob).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({
      claimed: 2,
      completed: 2,
      reachedBatchLimit: true,
    });
  });

  test("continua el lote cuando un trabajo falla", async () => {
    const jobs = [{ id: 1 }, { id: 2 }];
    const processJob = jest
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const summary = await drainMetricJobs({
      claimJob: async () => jobs.shift() || null,
      processJob,
      maxJobs: 50,
      maxRuntimeMs: 60_000,
    });

    expect(summary).toMatchObject({ claimed: 2, completed: 1, failed: 1 });
  });

  test("normaliza la configuracion del lote", () => {
    expect(
      getMetricsBatchOptions({
        METRICS_WORKER_BATCH_SIZE: "25",
        METRICS_WORKER_MAX_RUNTIME_MS: "90000",
      }),
    ).toEqual({ maxJobs: 25, maxRuntimeMs: 90_000 });
    expect(getMetricsBatchOptions({})).toEqual({
      maxJobs: 50,
      maxRuntimeMs: 8 * 60 * 1000,
    });
  });
});
