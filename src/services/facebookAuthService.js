import { normalizeAuthEmail } from "../utils/normalizeAuthEmail.js";

const FACEBOOK_AUTHORIZE_URL = "https://www.facebook.com/dialog/oauth";
const FACEBOOK_GRAPH_URL = "https://graph.facebook.com";

const configurationError = () => {
  const error = new Error(
    "El acceso con Facebook no está configurado temporalmente.",
  );
  error.statusCode = 503;
  error.code = "FACEBOOK_AUTH_NOT_CONFIGURED";
  return error;
};

const invalidCredentialError = () => {
  const error = new Error("No pudimos validar tu cuenta de Facebook.");
  error.statusCode = 401;
  error.code = "INVALID_FACEBOOK_CREDENTIAL";
  return error;
};

const getFacebookConfiguration = () => {
  const appId = String(process.env.FACEBOOK_APP_ID || "").trim();
  const appSecret = String(process.env.FACEBOOK_APP_SECRET || "").trim();
  const callbackUrl = String(process.env.FACEBOOK_CALLBACK_URL || "").trim();
  if (!appId || !appSecret || !callbackUrl) throw configurationError();
  return { appId, appSecret, callbackUrl };
};

const readJson = async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw invalidCredentialError();
  return payload;
};

export const createFacebookAuthorizationUrl = (state) => {
  const { appId, callbackUrl } = getFacebookConfiguration();
  const url = new URL(FACEBOOK_AUTHORIZE_URL);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "email,public_profile");
  return url.toString();
};

export const verifyFacebookAuthorizationCode = async (code) => {
  const authorizationCode = String(code || "").trim();
  if (!authorizationCode) throw invalidCredentialError();

  const { appId, appSecret, callbackUrl } = getFacebookConfiguration();
  const tokenBody = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: callbackUrl,
    code: authorizationCode,
  });
  const tokenPayload = await readJson(
    await fetch(`${FACEBOOK_GRAPH_URL}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    }),
  );
  const accessToken = String(tokenPayload?.access_token || "").trim();
  if (!accessToken) throw invalidCredentialError();

  const debugUrl = new URL(`${FACEBOOK_GRAPH_URL}/debug_token`);
  debugUrl.searchParams.set("input_token", accessToken);
  debugUrl.searchParams.set("access_token", `${appId}|${appSecret}`);
  const debugPayload = await readJson(await fetch(debugUrl));
  if (
    debugPayload?.data?.is_valid !== true ||
    String(debugPayload?.data?.app_id || "") !== appId
  ) {
    throw invalidCredentialError();
  }

  const profileUrl = new URL(`${FACEBOOK_GRAPH_URL}/me`);
  profileUrl.searchParams.set("fields", "id,name,email");
  profileUrl.searchParams.set("access_token", accessToken);
  const profile = await readJson(await fetch(profileUrl));
  const subject = String(profile?.id || "").trim();
  const email = normalizeAuthEmail(profile?.email);
  const proposedName = String(profile?.name || "Atleta RIRFIT").trim();

  if (!subject || !email) {
    const error = new Error(
      "Facebook no compartió un correo electrónico con RIRFIT.",
    );
    error.statusCode = 400;
    error.code = "FACEBOOK_EMAIL_REQUIRED";
    throw error;
  }

  return {
    subject,
    email,
    name: (proposedName.length >= 2 ? proposedName : "Atleta RIRFIT").slice(
      0,
      80,
    ),
  };
};
