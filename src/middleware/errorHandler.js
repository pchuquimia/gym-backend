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

export const errorHandler = (err, _req, res, _next) => {
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
  if (!isProduction && err.stack) payload.stack = err.stack;

  if (!isProduction) {
    console.error(err);
  }

  res.status(statusCode).json(payload);
};
