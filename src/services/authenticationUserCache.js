const DEFAULT_TTL_MS = 5_000;
const MAX_ENTRIES = 512;

const authenticationUsers = new Map();
const authenticationReadsInFlight = new Map();

const getTtlMs = () => {
  // Production shares concurrent reads only. Persisted per-process permissions
  // cannot be revoked reliably across multiple API instances.
  if (process.env.NODE_ENV === "production") return 0;
  const configured = Number(
    process.env.AUTH_USER_CACHE_TTL_MS || DEFAULT_TTL_MS,
  );
  return Math.min(
    15_000,
    Math.max(500, Number.isFinite(configured) ? configured : DEFAULT_TTL_MS),
  );
};

const buildKey = (userId, sessionId = "") =>
  `${String(userId || "").trim()}:${String(sessionId || "legacy").trim()}`;

const trimCache = () => {
  while (authenticationUsers.size > MAX_ENTRIES) {
    authenticationUsers.delete(authenticationUsers.keys().next().value);
  }
};

export const loadCachedAuthenticationUser = async ({
  userId,
  sessionId,
  loader,
}) => {
  const key = buildKey(userId, sessionId);
  const cached = authenticationUsers.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    authenticationUsers.delete(key);
    authenticationUsers.set(key, cached);
    return cached.value;
  }
  if (cached) authenticationUsers.delete(key);

  const current = authenticationReadsInFlight.get(key);
  if (current) return current.promise;

  const entry = { invalidated: false, promise: null };
  const operation = Promise.resolve()
    .then(loader)
    .then((value) => {
      if (entry.invalidated) {
        return loadCachedAuthenticationUser({ userId, sessionId, loader });
      }
      const ttlMs = getTtlMs();
      if (value && ttlMs > 0) {
        authenticationUsers.set(key, {
          value,
          expiresAt: Date.now() + ttlMs,
        });
        trimCache();
      }
      return value;
    })
    .finally(() => {
      if (authenticationReadsInFlight.get(key) === entry) {
        authenticationReadsInFlight.delete(key);
      }
    });

  entry.promise = operation;
  authenticationReadsInFlight.set(key, entry);
  return operation;
};

export const invalidateAuthenticationUser = (userId) => {
  const prefix = `${String(userId || "").trim()}:`;
  if (prefix === ":") return;
  for (const key of authenticationUsers.keys()) {
    if (key.startsWith(prefix)) authenticationUsers.delete(key);
  }
  for (const [key, entry] of authenticationReadsInFlight) {
    if (key.startsWith(prefix)) {
      entry.invalidated = true;
      authenticationReadsInFlight.delete(key);
    }
  }
};

export const resetAuthenticationUserCache = () => {
  authenticationUsers.clear();
  for (const entry of authenticationReadsInFlight.values())
    entry.invalidated = true;
  authenticationReadsInFlight.clear();
};

export const getAuthenticationUserCacheStatus = () => ({
  entries: authenticationUsers.size,
  inFlight: authenticationReadsInFlight.size,
  ttlMs: getTtlMs(),
});
