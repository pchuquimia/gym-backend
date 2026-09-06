import {
  buildPasswordResetEmail,
  buildVerificationEmail,
} from "../src/utils/email.js";

describe("RIRFIT transactional email templates", () => {
  test("builds a branded password reset email", () => {
    const message = buildPasswordResetEmail({
      name: "Ana",
      resetUrl: "https://rirfit.com/restablecer-contrasena?token=abc&next=1",
    });

    expect(message.subject).toBe("Restablece tu contraseña | RIRFIT");
    expect(message.text).toContain("El enlace vence en 30 minutos");
    expect(message.html).toContain("RIR<span");
    expect(message.html).toContain("Crear nueva contraseña");
    expect(message.html).toContain("token=abc&amp;next=1");
    expect(message.html).not.toContain("Apex Performance");
  });

  test("builds a verification email and escapes user content", () => {
    const message = buildVerificationEmail({
      name: "<script>alert('x')</script>",
      verifyUrl: "https://rirfit.com/verificar-correo?token=xyz",
    });

    expect(message.subject).toBe("Verifica tu correo | RIRFIT");
    expect(message.text).toContain("El enlace vence en 24 horas");
    expect(message.html).toContain("Verificar mi correo");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).not.toContain("<script>alert");
  });
});
