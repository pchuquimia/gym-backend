import nodemailer from "nodemailer";
import {
  assertEmailConfiguration,
  getEmailConfiguration,
  isEmailConfigured,
} from "../config/email.js";

let cachedTransport = null;
let cachedTransportKey = "";

const getTransport = () => {
  const configuration = assertEmailConfiguration();
  const nextKey = JSON.stringify(configuration.transport);
  if (!cachedTransport || cachedTransportKey !== nextKey) {
    cachedTransport = nodemailer.createTransport(configuration.transport);
    cachedTransportKey = nextKey;
  }
  return { configuration, transport: cachedTransport };
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export const sendPasswordResetEmail = async ({ email, name, resetUrl }) => {
  const { configuration, transport } = getTransport();
  return transport.sendMail({
    from: configuration.from,
    replyTo: configuration.replyTo || undefined,
    to: email,
    subject: "Restablece tu contraseña de Apex Performance",
    text: `Hola ${name}. Restablece tu contraseña desde este enlace: ${resetUrl}. El enlace vence en 30 minutos.`,
    html: `<p>Hola ${escapeHtml(name)},</p><p>Solicitaste restablecer tu contraseña de Apex Performance.</p><p><a href="${escapeHtml(resetUrl)}">Crear una nueva contraseña</a></p><p>El enlace vence en 30 minutos. Si no realizaste esta solicitud, puedes ignorar este correo.</p>`,
  });
};

export const sendVerificationEmail = async ({ email, name, verifyUrl }) => {
  const { configuration, transport } = getTransport();
  return transport.sendMail({
    from: configuration.from,
    replyTo: configuration.replyTo || undefined,
    to: email,
    subject: "Verifica tu cuenta de Apex Performance",
    text: `Hola ${name}. Verifica tu cuenta desde este enlace: ${verifyUrl}. El enlace vence en 24 horas.`,
    html: `<p>Hola ${escapeHtml(name)},</p><p>Confirma que este correo te pertenece para activar tu cuenta de Apex Performance.</p><p><a href="${escapeHtml(verifyUrl)}">Verificar mi cuenta</a></p><p>El enlace vence en 24 horas.</p>`,
  });
};

export const verifyEmailTransport = async () => {
  const { transport } = getTransport();
  return transport.verify();
};

export const resetEmailTransport = () => {
  cachedTransport?.close?.();
  cachedTransport = null;
  cachedTransportKey = "";
};

export { getEmailConfiguration, isEmailConfigured };
