import { performance } from "node:perf_hooks";

const round = (value) => Math.round(value * 10) / 10;
const MAX_TRACKED_ROUTES = Math.max(
  20,
  Number(process.env.PERFORMANCE_MAX_ROUTES || 100),
);
const SAMPLE_LIMIT = Math.max(
  20,
  Number(process.env.PERFORMANCE_SAMPLE_LIMIT || 250),
);
const routeMetrics = new Map();

const percentile = (values, percentage) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1);
  return round(sorted[index]);
};

const normalizePath = (req) => {
  const configuredPath = Array.isArray(req.route?.path)
    ? req.route.path[0]
    : req.route?.path;
  if (configuredPath) return `${req.baseUrl || ""}${configuredPath}`;
  const pathname = String(req.originalUrl || req.url || "/").split("?")[0];
  return pathname
    .split("/")
    .map((segment) => {
      if (/^[a-f0-9]{24}$/i.test(segment)) return ":id";
      if (/^[a-f0-9-]{36}$/i.test(segment)) return ":uuid";
      if (/^\d+$/.test(segment)) return ":number";
      if (segment.length > 40) return ":token";
      return segment;
    })
    .join("/");
};

const responseSize = (res, args) => {
  const declared = Number(res.getHeader("content-length"));
  if (Number.isFinite(declared) && declared >= 0) return declared;
  const body = args[0];
  if (Buffer.isBuffer(body)) return body.length;
  if (typeof body === "string") return Buffer.byteLength(body);
  return 0;
};

const recordPerformance = (req, res, sample) => {
  const key = `${req.method} ${normalizePath(req)}`;
  let metric = routeMetrics.get(key);
  if (!metric) {
    if (routeMetrics.size >= MAX_TRACKED_ROUTES) {
      routeMetrics.delete(routeMetrics.keys().next().value);
    }
    metric = { key, samples: [], totalRequests: 0, cacheHits: 0, errors: 0 };
    routeMetrics.set(key, metric);
  }
  metric.totalRequests += 1;
  if (sample.statusCode >= 400) metric.errors += 1;
  if (sample.cacheStatus?.includes("HIT")) metric.cacheHits += 1;
  metric.samples.push(sample);
  if (metric.samples.length > SAMPLE_LIMIT) metric.samples.shift();
};

export const resetPerformanceMetrics = () => routeMetrics.clear();

export const getPerformanceSnapshot = () => ({
  generatedAt: new Date().toISOString(),
  sampleLimit: SAMPLE_LIMIT,
  routes: [...routeMetrics.values()]
    .map((metric) => {
      const samples = metric.samples;
      const durations = samples.map((sample) => sample.totalDurationMs);
      const databaseDurations = samples.map(
        (sample) => sample.databaseDurationMs,
      );
      const sizes = samples.map((sample) => sample.responseBytes);
      const databaseOperations = samples.map(
        (sample) => sample.databaseOperations,
      );
      const statuses = samples.reduce((result, sample) => {
        result[sample.statusCode] = (result[sample.statusCode] || 0) + 1;
        return result;
      }, {});
      return {
        route: metric.key,
        totalRequests: metric.totalRequests,
        sampledRequests: samples.length,
        errors: metric.errors,
        cacheHitRate: metric.totalRequests
          ? round((metric.cacheHits / metric.totalRequests) * 100)
          : 0,
        durationMs: {
          p50: percentile(durations, 50),
          p95: percentile(durations, 95),
          p99: percentile(durations, 99),
          max: round(Math.max(0, ...durations)),
        },
        databaseMs: {
          p50: percentile(databaseDurations, 50),
          p95: percentile(databaseDurations, 95),
        },
        databaseOperations: {
          average: samples.length
            ? round(
                databaseOperations.reduce((sum, value) => sum + value, 0) /
                  samples.length,
              )
            : 0,
          max: Math.max(0, ...databaseOperations),
        },
        responseBytes: {
          p50: percentile(sizes, 50),
          p95: percentile(sizes, 95),
          max: Math.max(0, ...sizes),
        },
        statuses,
      };
    })
    .sort((left, right) => right.durationMs.p95 - left.durationMs.p95),
});

export const measureDatabase = async (res, operation, options = {}) => {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    res.locals.databaseDurationMs =
      Number(res.locals.databaseDurationMs || 0) +
      (performance.now() - startedAt);
    res.locals.databaseOperations =
      Number(res.locals.databaseOperations || 0) +
      Math.max(1, Number(options.operations || 1));
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
        `[slow-request] ${req.method} ${normalizePath(req)} total=${round(totalDurationMs)}ms db=${round(databaseDurationMs)}ms`,
      );
    }
    recordPerformance(req, res, {
      totalDurationMs: round(totalDurationMs),
      databaseDurationMs: round(databaseDurationMs),
      databaseOperations: Number(res.locals.databaseOperations || 0),
      responseBytes: responseSize(res, args),
      statusCode: res.statusCode,
      cacheStatus: String(res.getHeader("X-Data-Cache") || ""),
    });
    return originalEnd.apply(this, args);
  };

  next();
};
