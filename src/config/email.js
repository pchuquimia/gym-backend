const clean = (value) => String(value || "").trim();

const parsePort = (value, fallback) => {
  const port = Number(value || fallback);
  return Number.isInteger(port) && port > 0 && port <= 65535
    ? port
    : fallback;
};

const parseBoolean = (value, fallback = false) => {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return fallback;
  return normalized === "true";
};

export const getEmailConfiguration = (env = process.env) => {
  const explicitProvider = clean(env.EMAIL_PROVIDER).toLowerCase();
  const resendApiKey = clean(env.RESEND_API_KEY);
  const from = clean(env.EMAIL_FROM || env.SMTP_FROM);
  const replyTo = clean(env.EMAIL_REPLY_TO);
  const useResend = explicitProvider === "resend" || Boolean(resendApiKey);

  if (explicitProvider === "disabled") {
    return {
      configured: false,
      provider: "disabled",
      missing: [],
      from,
      replyTo,
      transport: null,
    };
  }

  if (useResend) {
    const missing = [];
    if (!resendApiKey) missing.push("RESEND_API_KEY");
    if (!from) missing.push("EMAIL_FROM");
    return {
      configured: missing.length === 0,
      provider: "resend",
      missing,
      from,
      replyTo,
      transport: {
        host: "smtp.resend.com",
        port: 465,
        secure: true,
        auth: {
          user: "resend",
          pass: resendApiKey,
        },
      },
    };
  }

  const host = clean(env.SMTP_HOST);
  const user = clean(env.SMTP_USER);
  const password = clean(env.SMTP_PASSWORD);
  const missing = [];
  if (!host) missing.push("SMTP_HOST");
  if (!from) missing.push("SMTP_FROM");
  if (Boolean(user) !== Boolean(password)) {
    missing.push(user ? "SMTP_PASSWORD" : "SMTP_USER");
  }

  return {
    configured: missing.length === 0 && Boolean(host && from),
    provider: host ? "smtp" : "disabled",
    missing,
    from,
    replyTo,
    transport: host
      ? {
          host,
          port: parsePort(env.SMTP_PORT, 587),
          secure: parseBoolean(env.SMTP_SECURE),
          auth: user && password ? { user, pass: password } : undefined,
        }
      : null,
  };
};

export const isEmailConfigured = (env = process.env) =>
  getEmailConfiguration(env).configured;

export const getEmailStatus = (env = process.env) => {
  const configuration = getEmailConfiguration(env);
  return {
    configured: configuration.configured,
    provider: configuration.provider,
    missing: configuration.missing,
  };
};

export const assertEmailConfiguration = (env = process.env) => {
  const configuration = getEmailConfiguration(env);
  if (configuration.configured) return configuration;

  const error = new Error(
    configuration.missing.length
      ? `Configuracion de correo incompleta: ${configuration.missing.join(", ")}`
      : "El servicio de correo esta deshabilitado.",
  );
  error.code = "EMAIL_NOT_CONFIGURED";
  error.statusCode = 503;
  throw error;
};
