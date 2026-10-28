const normalizeDuplicateKey = (err) => {
  if (err?.code !== 11000) return null;
  return {
    statusCode: 409,
    message: "El recurso ya existe",
  };
};

export const notFound = (req, _res, next) => {
  const err = new Error(`Ruta no encontrada: ${req.originalUrl}`);
  err.statusCode = 404;
  next(err);
};

export const errorHandler = (err, req, res, _next) => {
  const duplicate = normalizeDuplicateKey(err);
  const statusCode =
    duplicate?.statusCode || err.statusCode || err.status || 500;
  const isProduction = process.env.NODE_ENV === "production";

  const payload = {
    error:
      duplicate?.message ||
      (statusCode === 500 && isProduction
        ? "Internal Server Error"
        : err.message || "Internal Server Error"),
  };

  if (err.details && !isProduction) payload.details = err.details;
  if (typeof err.code === "string") payload.code = err.code;
  if (!isProduction && err.stack) payload.stack = err.stack;

  if (!isProduction) {
    console.error(err);
  } else if (statusCode >= 500) {
    // Error messages, query strings and request bodies may contain credentials
    // or health data. Log only metadata and stack frames, never their values.
    console.error({
      event: "request_error",
      requestId: res.locals.requestId,
      statusCode,
      method: req.method,
      route: req.route?.path || "(unmatched)",
      errorName: /^[A-Za-z]+Error$/.test(err.name || "") ? err.name : "Error",
      stack: String(err.stack || "")
        .split("\n")
        .filter((line) => /^\s+at /.test(line))
        .join("\n"),
    });
  }

  res.status(statusCode).json(payload);
};
