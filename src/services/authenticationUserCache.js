const DEFAULT_TTL_MS = 5_000;
const MAX_ENTRIES = 512;

const authenticationUsers = new Map();
const authenticationReadsInFlight = new Map();

const getTtlMs = () =>
  Math.min(
    15_000,
    Math.max(500, Number(process.env.AUTH_USER_CACHE_TTL_MS || DEFAULT_TTL_MS)),
  );

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
  if (current) return current;

  const operation = Promise.resolve()
    .then(loader)
    .then((value) => {
      if (value) {
        authenticationUsers.set(key, {
          value,
          expiresAt: Date.now() + getTtlMs(),
        });
        trimCache();
      }
      return value;
    })
    .finally(() => {
      if (authenticationReadsInFlight.get(key) === operation) {
        authenticationReadsInFlight.delete(key);
      }
    });

  authenticationReadsInFlight.set(key, operation);
  return operation;
};

export const invalidateAuthenticationUser = (userId) => {
  const prefix = `${String(userId || "").trim()}:`;
  if (prefix === ":") return;
  for (const key of authenticationUsers.keys()) {
    if (key.startsWith(prefix)) authenticationUsers.delete(key);
  }
};

export const resetAuthenticationUserCache = () => {
  authenticationUsers.clear();
  authenticationReadsInFlight.clear();
};

export const getAuthenticationUserCacheStatus = () => ({
  entries: authenticationUsers.size,
  inFlight: authenticationReadsInFlight.size,
  ttlMs: getTtlMs(),
});
