import { randomUUID } from "node:crypto";

export const requestId = (_req, res, next) => {
  res.locals.requestId = randomUUID();
  res.set("X-Request-Id", res.locals.requestId);
  next();
};
