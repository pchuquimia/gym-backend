const parseOrigins = (value = "") =>
  value
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);

export const isTrustedOrigin = (origin) => {
  if (!origin || origin === "null") return false;
  const allowedOrigins = [
    ...parseOrigins(process.env.CLIENT_URL),
    ...parseOrigins(process.env.CLIENT_URLS),
    ...parseOrigins(process.env.DEMO_CLIENT_URL),
    "https://gym-frontend-t65c.onrender.com",
    "https://gym-backend-1fod.onrender.com",
  ];
  if (allowedOrigins.includes(origin)) return true;
  return (
    process.env.NODE_ENV !== "production" &&
    /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(
      origin,
    )
  );
};
