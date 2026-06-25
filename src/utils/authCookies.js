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

const parseBooleanEnv = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  return ["true", "1", "yes"].includes(String(value).toLowerCase());
};

export const getCookieOptions = () => {
  const sameSite =
    process.env.COOKIE_SAMESITE ||
    (process.env.NODE_ENV === "production" ? "none" : "lax");
  const secure =
    String(sameSite).toLowerCase() === "none"
      ? true
      : parseBooleanEnv(
          process.env.COOKIE_SECURE,
          process.env.NODE_ENV === "production",
        );

  return {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: parseCookieExpiresMs(),
    path: "/",
  };
};

export const setAuthCookie = (res, token) => {
  res.cookie("jwt", token, getCookieOptions());
};

export const clearAuthCookie = (res) => {
  const options = getCookieOptions();
  res.clearCookie("jwt", {
    httpOnly: true,
    secure: options.secure,
    sameSite: options.sameSite,
    path: "/",
  });
};
