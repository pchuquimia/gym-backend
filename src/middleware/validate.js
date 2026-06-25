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
  minLength: 8,
  pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/,
  message:
    "La contraseña debe tener mínimo 8 caracteres, mayúscula, minúscula, número y símbolo",
};
