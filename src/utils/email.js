import nodemailer from "nodemailer";
import {
  assertEmailConfiguration,
  getEmailConfiguration,
  isEmailConfigured,
} from "../config/email.js";

let cachedTransport = null;
let cachedTransportKey = "";

const BRAND = {
  url: "https://rirfit.com",
  accent: "#dcf900",
  background: "#0c0d0d",
  surface: "#151515",
  surfaceSoft: "#1d1f1f",
  border: "#30322e",
  text: "#f7f7f4",
  muted: "#a9aaa5",
};

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

const displayName = (name) => String(name || "").trim() || "atleta";

const renderTransactionalEmail = ({
  preview,
  eyebrow,
  title,
  name,
  description,
  actionLabel,
  actionUrl,
  expiration,
  securityMessage,
}) => {
  const safeUrl = escapeHtml(actionUrl);
  const currentYear = new Date().getFullYear();

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <meta name="supported-color-schemes" content="dark">
    <title>${escapeHtml(title)}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .email-shell { width: 100% !important; }
        .email-card { padding: 32px 22px !important; }
        .email-header { padding: 22px !important; }
        .email-title { font-size: 30px !important; line-height: 36px !important; }
        .email-button { display: block !important; text-align: center !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.background};color:${BRAND.text};font-family:Inter,Arial,sans-serif;-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preview)}&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${BRAND.background};">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
            <tr>
              <td class="email-header" style="padding:24px 30px;background:${BRAND.surfaceSoft};border:1px solid ${BRAND.border};border-bottom:0;border-radius:20px 20px 0 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="font-size:25px;font-weight:900;letter-spacing:-1px;color:${BRAND.text};">RIR<span style="color:${BRAND.accent};">FIT</span></td>
                    <td align="right" style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:${BRAND.muted};">ENTRENA CON INTENCIÓN</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-card" style="padding:46px 42px;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:0 0 20px 20px;">
                <p style="margin:0 0 18px;font-size:12px;font-weight:800;letter-spacing:1.6px;color:${BRAND.accent};text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
                <h1 class="email-title" style="margin:0 0 22px;font-size:38px;line-height:44px;letter-spacing:-1.2px;color:${BRAND.text};">${escapeHtml(title)}</h1>
                <p style="margin:0 0 12px;font-size:17px;line-height:27px;color:${BRAND.text};">Hola, <strong>${escapeHtml(displayName(name))}</strong>.</p>
                <p style="margin:0 0 28px;font-size:16px;line-height:26px;color:${BRAND.muted};">${escapeHtml(description)}</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;">
                  <tr>
                    <td bgcolor="${BRAND.accent}" style="border-radius:12px;">
                      <a class="email-button" href="${safeUrl}" target="_blank" style="display:inline-block;padding:16px 25px;border:1px solid ${BRAND.accent};border-radius:12px;background:${BRAND.accent};color:#090909;font-size:15px;font-weight:900;line-height:20px;text-decoration:none;">${escapeHtml(actionLabel)} &nbsp;→</a>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 30px;background:${BRAND.surfaceSoft};border:1px solid ${BRAND.border};border-radius:12px;">
                  <tr>
                    <td style="padding:17px 18px;font-size:14px;line-height:21px;color:${BRAND.muted};">
                      <strong style="color:${BRAND.text};">Tiempo limitado:</strong> ${escapeHtml(expiration)}
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 9px;font-size:13px;line-height:20px;color:${BRAND.muted};">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
                <p style="margin:0 0 30px;font-size:12px;line-height:19px;word-break:break-all;"><a href="${safeUrl}" style="color:${BRAND.accent};text-decoration:underline;">${safeUrl}</a></p>
                <div style="height:1px;background:${BRAND.border};margin:0 0 24px;"></div>
                <p style="margin:0;font-size:13px;line-height:21px;color:${BRAND.muted};"><strong style="color:${BRAND.text};">Tu seguridad importa.</strong> ${escapeHtml(securityMessage)}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 18px 0;font-size:12px;line-height:19px;color:#777a74;">
                <a href="${BRAND.url}" style="color:${BRAND.muted};text-decoration:none;">rirfit.com</a><br>
                © ${currentYear} RIRFIT · Mensaje automático de seguridad
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

export const buildPasswordResetEmail = ({ name, resetUrl }) => ({
  subject: "Restablece tu contraseña | RIRFIT",
  text: `Hola, ${displayName(name)}.\n\nRecibimos una solicitud para restablecer tu contraseña de RIRFIT.\n\nCrear una nueva contraseña: ${resetUrl}\n\nEl enlace vence en 30 minutos. Si no solicitaste este cambio, ignora este mensaje; tu contraseña seguirá siendo la misma.`,
  html: renderTransactionalEmail({
    preview: "Crea una nueva contraseña para tu cuenta RIRFIT.",
    eyebrow: "Seguridad de cuenta",
    title: "Recupera tu acceso",
    name,
    description:
      "Recibimos una solicitud para restablecer la contraseña de tu cuenta. Usa el siguiente enlace para crear una nueva.",
    actionLabel: "Crear nueva contraseña",
    actionUrl: resetUrl,
    expiration: "Este enlace vence en 30 minutos.",
    securityMessage:
      "Si no solicitaste este cambio, ignora el mensaje. Tu contraseña seguirá siendo la misma.",
  }),
});

export const buildVerificationEmail = ({ name, verifyUrl }) => ({
  subject: "Verifica tu correo | RIRFIT",
  text: `Hola, ${displayName(name)}.\n\nConfirma tu correo para activar tu cuenta RIRFIT.\n\nVerificar mi correo: ${verifyUrl}\n\nEl enlace vence en 24 horas. Si no creaste esta cuenta o no solicitaste el cambio, ignora este mensaje.`,
  html: renderTransactionalEmail({
    preview: "Confirma tu correo y activa tu cuenta RIRFIT.",
    eyebrow: "Un último paso",
    title: "Confirma tu correo",
    name,
    description:
      "Verifica que esta dirección te pertenece para activar tu cuenta y mantenerla protegida.",
    actionLabel: "Verificar mi correo",
    actionUrl: verifyUrl,
    expiration: "Este enlace vence en 24 horas.",
    securityMessage:
      "Si no creaste esta cuenta o no solicitaste el cambio de correo, puedes ignorar este mensaje.",
  }),
});

export const sendPasswordResetEmail = async ({ email, name, resetUrl }) => {
  const { configuration, transport } = getTransport();
  return transport.sendMail({
    from: configuration.from,
    replyTo: configuration.replyTo || undefined,
    to: email,
    ...buildPasswordResetEmail({ name, resetUrl }),
  });
};

export const sendVerificationEmail = async ({ email, name, verifyUrl }) => {
  const { configuration, transport } = getTransport();
  return transport.sendMail({
    from: configuration.from,
    replyTo: configuration.replyTo || undefined,
    to: email,
    ...buildVerificationEmail({ name, verifyUrl }),
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
