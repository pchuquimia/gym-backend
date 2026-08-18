import { performance } from "node:perf_hooks";

const round = (value) => Math.round(value * 10) / 10;

export const measureDatabase = async (res, operation) => {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    res.locals.databaseDurationMs =
      Number(res.locals.databaseDurationMs || 0) +
      (performance.now() - startedAt);
    res.locals.databaseOperations =
      Number(res.locals.databaseOperations || 0) + 1;
  }
};

export const performanceTiming = (req, res, next) => {
  const startedAt = performance.now();
  const originalEnd = res.end;

  res.end = function timedEnd(...args) {
    const totalDurationMs = performance.now() - startedAt;
    const databaseDurationMs = Number(res.locals.databaseDurationMs || 0);
    const applicationDurationMs = Math.max(
      0,
      totalDurationMs - databaseDurationMs,
    );
    if (!res.headersSent) {
      const timings = [
        `app;dur=${round(applicationDurationMs)}`,
        `total;dur=${round(totalDurationMs)}`,
      ];
      if (databaseDurationMs > 0) {
        timings.unshift(
          `db;dur=${round(databaseDurationMs)};desc="${Number(res.locals.databaseOperations || 0)} ops"`,
        );
      }
      res.setHeader("Server-Timing", timings.join(", "));
      res.setHeader("X-Response-Time", `${round(totalDurationMs)}ms`);
      res.setHeader("Timing-Allow-Origin", "*");
    }

    const slowThreshold = Math.max(
      250,
      Number(process.env.SLOW_REQUEST_MS || 1500),
    );
    if (totalDurationMs >= slowThreshold) {
      console.warn(
        `[slow-request] ${req.method} ${req.originalUrl} total=${round(totalDurationMs)}ms db=${round(databaseDurationMs)}ms`,
      );
    }
    return originalEnd.apply(this, args);
  };

  next();
};
