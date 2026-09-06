import { jest } from "@jest/globals";

const verifyIdToken = jest.fn();
const OAuth2Client = jest.fn(() => ({ verifyIdToken }));

jest.unstable_mockModule("google-auth-library", () => ({ OAuth2Client }));

const { verifyGoogleCredential } =
  await import("../src/services/googleAuthService.js");

describe("Google auth service", () => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID =
      "google-client-id.apps.googleusercontent.com";
    verifyIdToken.mockReset();
    OAuth2Client.mockClear();
  });

  afterAll(() => {
    if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = previousClientId;
  });

  test("valida audiencia y normaliza una identidad verificada", async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: "google-subject-123",
        email: "I.POUK.19+prueba@googlemail.com",
        email_verified: true,
        name: "Atleta Prueba",
      }),
    });

    await expect(
      verifyGoogleCredential("signed-google-id-token"),
    ).resolves.toEqual({
      subject: "google-subject-123",
      email: "ipouk19@gmail.com",
      name: "Atleta Prueba",
    });
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: "signed-google-id-token",
      audience: "google-client-id.apps.googleusercontent.com",
    });
  });

  test("rechaza identidades cuyo correo no fue verificado por Google", async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: "google-subject-456",
        email: "ipouk19@gmail.com",
        email_verified: false,
      }),
    });

    await expect(
      verifyGoogleCredential("signed-google-id-token"),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_GOOGLE_CREDENTIAL",
    });
  });
});
