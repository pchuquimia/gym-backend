import { performance } from "node:perf_hooks";

const TARGETS = Object.freeze({
  health: "/api/health",
  dashboard: "/api/dashboard/bootstrap",
  portfolio: "/api/coach/portfolio",
  athletes: "/api/coach/athletes",
});
const AUTHENTICATED_TARGETS = new Set(["dashboard", "portfolio", "athletes"]);

const clampInteger = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed)
    ? Math.min(max, Math.max(min, parsed))
    : fallback;
};

const percentile = (values, percentage) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const value =
    sorted[Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1)];
  return Math.round(value * 10) / 10;
};

const serverTimingValue = (header, metric) => {
  const match = String(header || "").match(
    new RegExp(`(?:^|,\\s*)${metric};dur=([0-9.]+)`),
  );
  return match ? Number(match[1]) : null;
};

const targetName = String(process.argv[2] || "health").toLowerCase();
const targetPath = TARGETS[targetName];
if (!targetPath) {
  throw new Error(
    `Objetivo invalido. Usa uno de: ${Object.keys(TARGETS).join(", ")}`,
  );
}

const requests = clampInteger(process.argv[3], 50, 1, 2000);
const concurrency = clampInteger(process.argv[4], 10, 1, 100);
const baseUrl = String(
  process.env.LOAD_TEST_BASE_URL || "http://localhost:4000",
).replace(/\/$/, "");
const token = String(process.env.LOAD_TEST_TOKEN || "").trim();
if (AUTHENTICATED_TARGETS.has(targetName) && !token) {
  throw new Error(
    "Configura LOAD_TEST_TOKEN con el token de una cuenta de prueba. No lo pases como argumento ni lo guardes en el repositorio.",
  );
}

const today = new Date().toISOString().slice(0, 10);
const query = ["dashboard", "portfolio"].includes(targetName)
  ? `?today=${today}`
  : "";
const url = `${baseUrl}${targetPath}${query}`;
const results = [];
let cursor = 0;

const runRequest = async () => {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(20_000),
    });
    await response.arrayBuffer();
    results.push({
      durationMs: performance.now() - startedAt,
      status: response.status,
      cache: response.headers.get("x-data-cache") || "",
      serverTiming: response.headers.get("server-timing") || "",
    });
  } catch (error) {
    results.push({
      durationMs: performance.now() - startedAt,
      status: 0,
      cache: "",
      serverTiming: "",
      error: error.message,
    });
  }
};

const worker = async () => {
  while (cursor < requests) {
    cursor += 1;
    await runRequest();
  }
};

const suiteStartedAt = performance.now();
await Promise.all(
  Array.from({ length: Math.min(concurrency, requests) }, () => worker()),
);
const elapsedMs = performance.now() - suiteStartedAt;
const durations = results.map((result) => result.durationMs);
const serverDurations = results
  .map((result) => serverTimingValue(result.serverTiming, "total"))
  .filter(Number.isFinite);
const databaseDurations = results
  .map((result) => serverTimingValue(result.serverTiming, "db"))
  .filter(Number.isFinite);
const statuses = results.reduce((summary, result) => {
  summary[result.status] = (summary[result.status] || 0) + 1;
  return summary;
}, {});
const cacheHits = results.filter((result) =>
  result.cache.includes("HIT"),
).length;

console.log(
  JSON.stringify(
    {
      target: targetName,
      baseUrl,
      requests,
      concurrency,
      elapsedMs: Math.round(elapsedMs),
      throughputPerSecond:
        Math.round((results.length / Math.max(0.001, elapsedMs / 1000)) * 10) /
        10,
      durationMs: {
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        p99: percentile(durations, 99),
        max: Math.round(Math.max(0, ...durations)),
      },
      serverDurationMs: {
        p50: percentile(serverDurations, 50),
        p95: percentile(serverDurations, 95),
        p99: percentile(serverDurations, 99),
      },
      databaseDurationMs: {
        p50: percentile(databaseDurations, 50),
        p95: percentile(databaseDurations, 95),
      },
      cacheHitRate: results.length
        ? Math.round((cacheHits / results.length) * 1000) / 10
        : 0,
      statuses,
      failures: results
        .filter((result) => result.error)
        .slice(0, 5)
        .map((result) => result.error),
    },
    null,
    2,
  ),
);

if (results.some((result) => result.status === 0 || result.status >= 500)) {
  process.exitCode = 1;
}
