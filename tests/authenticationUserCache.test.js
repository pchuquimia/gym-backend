import {
  getAuthenticationUserCacheStatus,
  invalidateAuthenticationUser,
  loadCachedAuthenticationUser,
  resetAuthenticationUserCache,
} from "../src/services/authenticationUserCache.js";

describe("authentication user cache", () => {
  beforeEach(() => resetAuthenticationUserCache());

  test("comparte la lectura simultanea y reutiliza el resultado por sesion", async () => {
    let reads = 0;
    const loader = async () => {
      reads += 1;
      return { id: "user-1", activeSessions: [{ sessionId: "session-1" }] };
    };

    const [first, second] = await Promise.all([
      loadCachedAuthenticationUser({
        userId: "user-1",
        sessionId: "session-1",
        loader,
      }),
      loadCachedAuthenticationUser({
        userId: "user-1",
        sessionId: "session-1",
        loader,
      }),
    ]);
    const third = await loadCachedAuthenticationUser({
      userId: "user-1",
      sessionId: "session-1",
      loader,
    });

    expect(reads).toBe(1);
    expect(first).toBe(second);
    expect(third).toBe(first);
    expect(getAuthenticationUserCacheStatus().entries).toBe(1);
  });

  test("aísla sesiones e invalida todas las entradas del usuario", async () => {
    let reads = 0;
    const loader = async () => ({ version: ++reads });

    await loadCachedAuthenticationUser({
      userId: "user-1",
      sessionId: "session-1",
      loader,
    });
    await loadCachedAuthenticationUser({
      userId: "user-1",
      sessionId: "session-2",
      loader,
    });
    expect(reads).toBe(2);

    invalidateAuthenticationUser("user-1");
    await loadCachedAuthenticationUser({
      userId: "user-1",
      sessionId: "session-1",
      loader,
    });

    expect(reads).toBe(3);
  });
});
