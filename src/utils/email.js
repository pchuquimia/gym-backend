import nodemailer from "nodemailer";

const smtpConfigured = () =>
  Boolean(
    process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_FROM,
  );

const createTransport = () =>
  nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        }
      : undefined,
  });

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export const sendPasswordResetEmail = async ({ email, name, resetUrl }) => {
  if (!smtpConfigured()) {
    const err = new Error(
      "La recuperación por correo no está configurada temporalmente.",
    );
    err.statusCode = 503;
    throw err;
  }

  await createTransport().sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: "Restablece tu contraseña de Apex Performance",
    text: `Hola ${name}. Restablece tu contraseña desde este enlace: ${resetUrl}. El enlace vence en 30 minutos.`,
    html: `<p>Hola ${escapeHtml(name)},</p><p>Solicitaste restablecer tu contraseña de Apex Performance.</p><p><a href="${escapeHtml(resetUrl)}">Crear una nueva contraseña</a></p><p>El enlace vence en 30 minutos. Si no realizaste esta solicitud, puedes ignorar este correo.</p>`,
  });
};

export const sendVerificationEmail = async ({ email, name, verifyUrl }) => {
  if (!smtpConfigured()) {
    const err = new Error(
      "La verificación por correo no está configurada temporalmente.",
    );
    err.statusCode = 503;
    throw err;
  }

  await createTransport().sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: "Verifica tu cuenta de Apex Performance",
    text: `Hola ${name}. Verifica tu cuenta desde este enlace: ${verifyUrl}. El enlace vence en 24 horas.`,
    html: `<p>Hola ${escapeHtml(name)},</p><p>Confirma que este correo te pertenece para activar tu cuenta de Apex Performance.</p><p><a href="${escapeHtml(verifyUrl)}">Verificar mi cuenta</a></p><p>El enlace vence en 24 horas.</p>`,
  });
};

export const isEmailConfigured = smtpConfigured;
