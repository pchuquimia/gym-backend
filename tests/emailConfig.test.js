import {
  assertEmailConfiguration,
  getEmailConfiguration,
  getEmailStatus,
  isEmailConfigured,
} from "../src/config/email.js";

describe("email configuration", () => {
  test("configura Resend con una API key y remitente", () => {
    const configuration = getEmailConfiguration({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "Apex Performance <no-reply@mail.apex.test>",
      EMAIL_REPLY_TO: "soporte@apex.test",
    });

    expect(configuration).toMatchObject({
      configured: true,
      provider: "resend",
      from: "Apex Performance <no-reply@mail.apex.test>",
      replyTo: "soporte@apex.test",
      transport: {
        host: "smtp.resend.com",
        port: 465,
        secure: true,
        auth: { user: "resend", pass: "re_test_key" },
      },
    });
    expect(isEmailConfigured({
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "no-reply@mail.apex.test",
    })).toBe(true);
  });

  test("informa las variables que faltan sin exponer secretos", () => {
    const status = getEmailStatus({ EMAIL_PROVIDER: "resend" });
    expect(status).toEqual({
      configured: false,
      provider: "resend",
      missing: ["RESEND_API_KEY", "EMAIL_FROM"],
    });
    expect(() =>
      assertEmailConfiguration({ EMAIL_PROVIDER: "resend" }),
    ).toThrow(/RESEND_API_KEY, EMAIL_FROM/);
  });

  test("mantiene compatibilidad con SMTP autenticado", () => {
    const configuration = getEmailConfiguration({
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_USER: "service",
      SMTP_PASSWORD: "secret",
      SMTP_FROM: "no-reply@example.test",
    });

    expect(configuration.configured).toBe(true);
    expect(configuration.provider).toBe("smtp");
    expect(configuration.transport).toMatchObject({
      host: "smtp.example.test",
      port: 587,
      secure: false,
      auth: { user: "service", pass: "secret" },
    });
  });

  test("rechaza credenciales SMTP parciales", () => {
    const configuration = getEmailConfiguration({
      SMTP_HOST: "smtp.example.test",
      SMTP_FROM: "no-reply@example.test",
      SMTP_USER: "service",
    });
    expect(configuration.configured).toBe(false);
    expect(configuration.missing).toContain("SMTP_PASSWORD");
  });

  test("permite deshabilitar correo de forma explicita", () => {
    expect(getEmailStatus({ EMAIL_PROVIDER: "disabled" })).toEqual({
      configured: false,
      provider: "disabled",
      missing: [],
    });
  });
});
