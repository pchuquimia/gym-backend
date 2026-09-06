import { OAuth2Client } from "google-auth-library";
import { normalizeAuthEmail } from "../utils/normalizeAuthEmail.js";

let cachedClientId = "";
let cachedClient = null;

const configurationError = () => {
  const error = new Error(
    "El acceso con Google no está configurado temporalmente.",
  );
  error.statusCode = 503;
  error.code = "GOOGLE_AUTH_NOT_CONFIGURED";
  return error;
};

const invalidCredentialError = () => {
  const error = new Error("No pudimos validar tu cuenta de Google.");
  error.statusCode = 401;
  error.code = "INVALID_GOOGLE_CREDENTIAL";
  return error;
};

const getGoogleClient = () => {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  if (!clientId) throw configurationError();

  if (!cachedClient || cachedClientId !== clientId) {
    cachedClientId = clientId;
    cachedClient = new OAuth2Client(clientId);
  }

  return { client: cachedClient, clientId };
};

export const verifyGoogleCredential = async (credential) => {
  const token = String(credential || "").trim();
  if (!token) throw invalidCredentialError();

  const { client, clientId } = getGoogleClient();

  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    const subject = String(payload?.sub || "").trim();
    const email = normalizeAuthEmail(payload?.email);

    if (!subject || !email || payload?.email_verified !== true) {
      throw invalidCredentialError();
    }

    const proposedName = String(
      payload?.name || payload?.given_name || "Atleta RIRFIT",
    ).trim();

    return {
      subject,
      email,
      name: (proposedName.length >= 2 ? proposedName : "Atleta RIRFIT").slice(
        0,
        80,
      ),
    };
  } catch (error) {
    if (error?.code === "INVALID_GOOGLE_CREDENTIAL") throw error;
    throw invalidCredentialError();
  }
};
