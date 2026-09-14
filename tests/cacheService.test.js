import {
  bumpCacheVersion,
  getCache,
  getCacheVersion,
  setCache,
} from "../src/services/cacheService.js";

describe("cache versioning", () => {
  const previousRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    delete process.env.REDIS_URL;
  });

  afterAll(() => {
    if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousRedisUrl;
  });

  test("invalida un namespace sin recorrer ni borrar sus claves", async () => {
    const namespace = `dashboard:test-${Date.now()}`;
    const firstVersion = await getCacheVersion(namespace);
    const firstKey = `${namespace}:v${firstVersion}:self`;
    await setCache(firstKey, { state: "anterior" }, 60);

    const nextVersion = await bumpCacheVersion(namespace);
    const nextKey = `${namespace}:v${nextVersion}:self`;

    expect(nextVersion).toBe(firstVersion + 1);
    expect(await getCache(firstKey)).toEqual({ state: "anterior" });
    expect(await getCache(nextKey)).toBeNull();

    await setCache(nextKey, { state: "actual" }, 60);
    expect(await getCache(nextKey)).toEqual({ state: "actual" });
  });
});
