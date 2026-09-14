import { createClient } from "redis";

const MEMORY_MAX_ENTRIES = Math.max(
  64,
  Number(process.env.CACHE_MEMORY_MAX_ENTRIES || 256),
);
const memoryCache = new Map();
const memoryVersions = new Map();
const VERSION_MEMORY_TTL_MS = Math.max(
  1000,
  Number(process.env.CACHE_VERSION_MEMORY_TTL_MS || 5000),
);
let redisClient = null;
let redisConnection = null;
let redisUnavailableUntil = 0;

const readMemory = (key) => {
  const cached = memoryCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) memoryCache.delete(key);
    return null;
  }
  memoryCache.delete(key);
  memoryCache.set(key, cached);
  return cached.value;
};

const writeMemory = (key, value, ttlSeconds) => {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  while (memoryCache.size > MEMORY_MAX_ENTRIES) {
    memoryCache.delete(memoryCache.keys().next().value);
  }
};

const readMemoryVersion = (namespace) => {
  const cached = memoryVersions.get(namespace);
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return cached.value;
};

const writeMemoryVersion = (namespace, value) => {
  memoryVersions.set(namespace, {
    value,
    expiresAt: Date.now() + VERSION_MEMORY_TTL_MS,
  });
  while (memoryVersions.size > MEMORY_MAX_ENTRIES) {
    memoryVersions.delete(memoryVersions.keys().next().value);
  }
};

const normalizeNamespace = (namespace) => String(namespace || "").trim();
const versionKey = (namespace) => `cache-version:${namespace}`;

const getRedis = async () => {
  const url = String(process.env.REDIS_URL || "").trim();
  if (!url || Date.now() < redisUnavailableUntil) return null;
  if (redisClient?.isReady) return redisClient;
  if (redisConnection) return redisConnection;

  redisClient = createClient({
    url,
    socket: {
      connectTimeout: 2500,
      reconnectStrategy: false,
    },
  });
  redisClient.on("error", (error) => {
    console.warn(`[cache] Redis no disponible: ${error.message}`);
  });
  redisConnection = redisClient
    .connect()
    .then(() => redisClient)
    .catch(() => {
      redisUnavailableUntil = Date.now() + 30_000;
      redisClient = null;
      return null;
    })
    .finally(() => {
      redisConnection = null;
    });
  return redisConnection;
};

export const getCache = async (key) => {
  const local = readMemory(key);
  if (local !== null) return local;
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const serialized = await redis.get(key);
    if (!serialized) return null;
    const value = JSON.parse(serialized);
    writeMemory(key, value, 15);
    return value;
  } catch (error) {
    console.warn(`[cache] No se pudo leer ${key}: ${error.message}`);
    return null;
  }
};

export const setCache = async (key, value, ttlSeconds = 60) => {
  const normalizedTtl = Math.max(1, Math.round(ttlSeconds));
  writeMemory(key, value, normalizedTtl);
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), { EX: normalizedTtl });
  } catch (error) {
    console.warn(`[cache] No se pudo escribir ${key}: ${error.message}`);
  }
};

export const deleteCache = async (...keys) => {
  const normalized = keys.flat().filter(Boolean);
  normalized.forEach((key) => memoryCache.delete(key));
  if (!normalized.length) return;
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.del(normalized);
  } catch (error) {
    console.warn(`[cache] No se pudo invalidar caché: ${error.message}`);
  }
};

export const getCacheVersion = async (namespace) => {
  const normalizedNamespace = normalizeNamespace(namespace);
  if (!normalizedNamespace) return 0;
  const local = readMemoryVersion(normalizedNamespace);
  if (local !== null) return local;
  const fallback = memoryVersions.get(normalizedNamespace)?.value ?? 0;

  const redis = await getRedis();
  if (!redis) {
    writeMemoryVersion(normalizedNamespace, fallback);
    return fallback;
  }
  try {
    const stored = Number(await redis.get(versionKey(normalizedNamespace)));
    const value = Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
    writeMemoryVersion(normalizedNamespace, value);
    return value;
  } catch (error) {
    console.warn(
      `[cache] No se pudo leer la version ${normalizedNamespace}: ${error.message}`,
    );
    writeMemoryVersion(normalizedNamespace, fallback);
    return fallback;
  }
};

export const bumpCacheVersion = async (namespace) => {
  const normalizedNamespace = normalizeNamespace(namespace);
  if (!normalizedNamespace) return 0;
  const current = memoryVersions.get(normalizedNamespace)?.value ?? 0;
  const localValue = current + 1;
  writeMemoryVersion(normalizedNamespace, localValue);

  const redis = await getRedis();
  if (!redis) return localValue;
  try {
    const value = Number(await redis.incr(versionKey(normalizedNamespace)));
    const normalizedValue = Number.isSafeInteger(value) ? value : localValue;
    writeMemoryVersion(normalizedNamespace, normalizedValue);
    return normalizedValue;
  } catch (error) {
    console.warn(
      `[cache] No se pudo incrementar la version ${normalizedNamespace}: ${error.message}`,
    );
    return localValue;
  }
};

export const getCacheStatus = () => ({
  provider: String(process.env.REDIS_URL || "").trim() ? "redis" : "memory",
  connected: Boolean(redisClient?.isReady),
  memoryEntries: memoryCache.size,
  memoryVersions: memoryVersions.size,
});
