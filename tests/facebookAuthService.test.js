import { jest } from "@jest/globals";
import {
  createFacebookAuthorizationUrl,
  verifyFacebookAuthorizationCode,
} from "../src/services/facebookAuthService.js";

const jsonResponse = (payload, ok = true) => ({
  ok,
  json: jest.fn().mockResolvedValue(payload),
});

describe("Facebook auth service", () => {
  const originalFetch = global.fetch;
  const previous = {
    appId: process.env.FACEBOOK_APP_ID,
    appSecret: process.env.FACEBOOK_APP_SECRET,
    callbackUrl: process.env.FACEBOOK_CALLBACK_URL,
  };

  beforeEach(() => {
    process.env.FACEBOOK_APP_ID = "facebook-app-123";
    process.env.FACEBOOK_APP_SECRET = "facebook-secret";
    process.env.FACEBOOK_CALLBACK_URL =
      "http://localhost:4000/api/auth/facebook/callback";
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
    Object.entries(previous).forEach(([key, value]) => {
      const envKey =
        key === "appId"
          ? "FACEBOOK_APP_ID"
          : key === "appSecret"
            ? "FACEBOOK_APP_SECRET"
            : "FACEBOOK_CALLBACK_URL";
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    });
  });

  test("crea una URL de autorización limitada a email y perfil público", () => {
    const url = new URL(createFacebookAuthorizationUrl("secure-state"));

    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.searchParams.get("client_id")).toBe("facebook-app-123");
    expect(url.searchParams.get("scope")).toBe("email,public_profile");
    expect(url.searchParams.get("state")).toBe("secure-state");
    expect(url.toString()).not.toContain("facebook-secret");
  });

  test("intercambia el código, valida la app y normaliza la identidad", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ access_token: "user-token" }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { is_valid: true, app_id: "facebook-app-123" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "facebook-subject-456",
          name: "Atleta Facebook",
          email: "I.POUK.19+fb@googlemail.com",
        }),
      );

    await expect(
      verifyFacebookAuthorizationCode("authorization-code"),
    ).resolves.toEqual({
      subject: "facebook-subject-456",
      name: "Atleta Facebook",
      email: "ipouk19@gmail.com",
    });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test("rechaza un token emitido para otra aplicación", async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ access_token: "user-token" }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { is_valid: true, app_id: "other-app" } }),
      );

    await expect(
      verifyFacebookAuthorizationCode("authorization-code"),
    ).rejects.toMatchObject({ code: "INVALID_FACEBOOK_CREDENTIAL" });
  });
});
