import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";

const loadCachedAuthenticationUser = jest.fn();
jest.unstable_mockModule("../src/services/authenticationUserCache.js", () => ({
  loadCachedAuthenticationUser,
}));
const { protect, authorizeRoles } = await import("../src/middleware/authMiddleware.js");

const secret = "auth-lifecycle-test-secret-only";
const previousSecret = process.env.JWT_SECRET;
const previousEnvironment = process.env.NODE_ENV;
const user = {
  _id: "user-1", name: "Atleta", isActive: true, role: "Cliente",
  activeSessions: [{ sessionId: "session-1" }],
};
const token = (payload = {}, options = {}) => jwt.sign(
  { id: "user-1", sid: "session-1", ...payload }, secret,
  { expiresIn: "1h", ...options },
);
const verify = async (accessToken) => {
  const req = { cookies: {}, headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {} };
  const next = jest.fn();
  await protect(req, {}, next);
  return { req, next, error: next.mock.calls[0]?.[0] };
};

beforeEach(() => {
  process.env.NODE_ENV = "production";
  process.env.JWT_SECRET = secret;
  loadCachedAuthenticationUser.mockReset().mockResolvedValue(user);
});
afterAll(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
  if (previousEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnvironment;
});

test("permite una sesión válida", async () => {
  const { req, error } = await verify(token());
  expect(error).toBeUndefined();
  expect(req.user.sessionId).toBe("session-1");
});

test.each([
  [undefined, "AUTH_SESSION_MISSING"],
  ["invalid-token", "AUTH_SESSION_INVALID"],
])("rechaza un acceso ausente o inválido (%s)", async (accessToken, code) => {
  expect((await verify(accessToken)).error).toMatchObject({ statusCode: 401, code });
});

test("distingue la caducidad del token", async () => {
  const result = await verify(token({}, { expiresIn: -1 }));
  expect(result.error).toMatchObject({ statusCode: 401, code: "AUTH_SESSION_EXPIRED" });
  expect(loadCachedAuthenticationUser).not.toHaveBeenCalled();
});

test("una sesión revocada exige volver a ingresar", async () => {
  loadCachedAuthenticationUser.mockResolvedValue({ ...user, activeSessions: [] });
  expect((await verify(token())).error).toMatchObject({ statusCode: 401, code: "AUTH_SESSION_REVOKED" });
});

test.each([null, { ...user, isActive: false }])("rechaza una cuenta no disponible", async (account) => {
  loadCachedAuthenticationUser.mockResolvedValue(account);
  expect((await verify(token())).error).toMatchObject({ statusCode: 401, code: "AUTH_ACCOUNT_UNAVAILABLE" });
});

test("distingue el final del acceso demo", async () => {
  loadCachedAuthenticationUser.mockResolvedValue({
    ...user, isDemo: true, demoExpiresAt: new Date(Date.now() - 1000),
  });
  expect((await verify(token())).error).toMatchObject({ statusCode: 401, code: "AUTH_DEMO_EXPIRED" });
});

test("en producción requiere un token ligado a la sesión", async () => {
  expect((await verify(token({ sid: undefined }))).error).toMatchObject({
    statusCode: 401, code: "AUTH_SESSION_INVALID",
  });
});

test("un fallo de base de datos responde 503 y no invalida credenciales", async () => {
  loadCachedAuthenticationUser.mockRejectedValue(new Error("database unavailable"));
  expect((await verify(token())).error).toMatchObject({
    statusCode: 503, code: "AUTH_VERIFICATION_UNAVAILABLE",
  });
});

test("un permiso insuficiente sigue siendo 403", () => {
  const next = jest.fn();
  authorizeRoles("Admin")({ user: { role: "Cliente" } }, {}, next);
  expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
});
