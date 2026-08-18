import { createClient } from "redis";

const MEMORY_MAX_ENTRIES = Math.max(
  64,
  Number(process.env.CACHE_MEMORY_MAX_ENTRIES || 256),
);
const memoryCache = new Map();
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

export const getCacheStatus = () => ({
  provider: String(process.env.REDIS_URL || "").trim() ? "redis" : "memory",
  connected: Boolean(redisClient?.isReady),
  memoryEntries: memoryCache.size,
});
