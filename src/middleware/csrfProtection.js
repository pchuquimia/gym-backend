import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isTrustedOrigin } from "../config/requestOrigins.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
// Google posts a form across origins. Its controller verifies the OAuth state
// cookie; it must not be subjected to the application's session CSRF token.
const oauthCallback = "/api/auth/google/callback";

const signature = (nonce, sessionToken) =>
  createHmac("sha256", process.env.JWT_SECRET)
    .update(`rirfit-csrf:${nonce}:${sessionToken || ""}`)
    .digest("hex");

export const issueCsrfToken = (req, res) => {
  const nonce = randomBytes(32).toString("hex");
  res.set("Cache-Control", "no-store");
  res.json({ csrfToken: `${nonce}.${signature(nonce, req.cookies?.jwt)}` });
};

export const csrfProtection = (req, res, next) => {
  if (safeMethods.has(req.method) || req.path === oauthCallback) return next();

  const origin = req.get("origin");
  if (origin && !isTrustedOrigin(origin)) {
    return res.status(403).json({
      error: "Origen de solicitud no autorizado",
      code: "UNTRUSTED_ORIGIN",
    });
  }

  // Bearer-only API clients do not use ambient browser credentials. Cookies,
  // including cookies on multipart requests, always require a session-bound token.
  if (!req.cookies?.jwt) return next();
  const supplied = String(req.get("x-csrf-token") || "");
  if (/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(supplied)) {
    const [nonce, mac] = supplied.split(".");
    const expected = signature(nonce, req.cookies.jwt);
    if (timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return next();
  }
  return res.status(403).json({
    error: "La sesión de seguridad cambió. Reintenta la solicitud.",
    code: "INVALID_CSRF_TOKEN",
  });
};
