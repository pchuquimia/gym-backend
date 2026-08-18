import assert from "node:assert/strict";

const baseUrl = String(
  process.env.API_BASE_URL || process.env.BASE_URL || "http://localhost:4000",
).replace(/\/$/, "");
const cookieJar = new Map();
let bearerToken = "";

const storeCookies = (response) => {
  const values = response.headers.getSetCookie?.() || [response.headers.get("set-cookie")];
  for (const value of values.filter(Boolean)) {
    const [pair] = value.split(";");
    const separator = pair.indexOf("=");
    if (separator > 0) cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
};

const request = async (pathname, options = {}) => {
  const headers = new Headers(options.headers || {});
  if (cookieJar.size) {
    headers.set(
      "Cookie",
      [...cookieJar].map(([key, value]) => `${key}=${value}`).join("; "),
    );
  }
  if (bearerToken) headers.set("Authorization", `Bearer ${bearerToken}`);
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
  storeCookies(response);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
};

const checks = [];
const check = async (name, callback) => {
  await callback();
  checks.push(name);
};

await check("health", async () => {
  const { response, body } = await request("/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(body, { ok: true });
});

await check("development admin authentication", async () => {
  const { response, body } = await request("/api/auth/dev-admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 200);
  assert.equal(body?.user?.role, "Admin");
  bearerToken = body?.token || "";
});

await check("current user", async () => {
  const { response, body } = await request("/api/auth/me");
  assert.equal(response.status, 200);
  assert.equal(typeof body?.user, "object");
  assert.equal(Object.hasOwn(body.user, "password"), false);
});

for (const [name, pathname] of [
  ["exercise catalog", "/api/exercises?page=1&limit=5&language=es"],
  ["routines", "/api/routines"],
  ["training history", "/api/trainings"],
]) {
  await check(name, async () => {
    const { response, body } = await request(pathname);
    assert.equal(response.status, 200);
    assert.equal(Array.isArray(body), true);
  });
}

console.log(
  JSON.stringify({ ok: true, baseUrl, checks: checks.length }, null, 2),
);
