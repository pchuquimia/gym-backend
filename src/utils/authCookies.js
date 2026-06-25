const parseCookieExpiresMs = () => {
  const raw = process.env.COOKIE_EXPIRES || "7d";
  const match = String(raw)
    .trim()
    .match(/^(\d+)([dhm])?$/i);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = (match[2] || "d").toLowerCase();
  if (unit === "h") return value * 60 * 60 * 1000;
  if (unit === "m") return value * 60 * 1000;
  return value * 24 * 60 * 60 * 1000;
};

export const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: parseCookieExpiresMs(),
  path: "/",
});

export const setAuthCookie = (res, token) => {
  res.cookie("jwt", token, getCookieOptions());
};

export const clearAuthCookie = (res) => {
  res.clearCookie("jwt", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
  });
};
