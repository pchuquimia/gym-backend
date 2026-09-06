import User from "../src/models/User.js";

describe("preferencias de correo del usuario", () => {
  test("no habilita comunicaciones sin consentimiento", () => {
    const user = new User({
      name: "Atleta",
      email: "atleta@example.com",
      password: "Rirfit1234",
    });

    expect(user.toSafeJSON().emailPreferences).toMatchObject({
      productUpdates: false,
      consentedAt: null,
    });
  });

  test("expone el consentimiento y su fecha cuando fueron registrados", () => {
    const consentedAt = new Date("2026-09-06T12:00:00.000Z");
    const user = new User({
      name: "Atleta",
      email: "atleta@example.com",
      password: "Rirfit1234",
      emailPreferences: { productUpdates: true, consentedAt },
    });

    expect(user.toSafeJSON().emailPreferences).toMatchObject({
      productUpdates: true,
      consentedAt,
    });
  });
});
