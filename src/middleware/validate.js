import { validationResult } from "express-validator";

export const validate = (req, _res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const err = new Error("Datos inválidos");
  err.statusCode = 400;
  err.details = errors.array().map((item) => ({
    field: item.path,
    message: item.msg,
  }));
  next(err);
};

export const passwordRules = {
  minLength: 6,
  pattern: /^.{6,72}$/s,
  message: "La contraseña debe tener entre 6 y 72 caracteres",
};
