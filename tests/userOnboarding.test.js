import User from "../src/models/User.js";

describe("user onboarding", () => {
  test("expone el estado pendiente y evita medidas corporales ficticias", () => {
    const user = new User({
      name: "Atleta Nuevo",
      email: "nuevo@example.com",
      password: "Rirfit1234",
      role: "Cliente",
      onboarding: { status: "pending" },
      profile: { weight: null, height: null },
    });

    expect(user.toSafeJSON()).toMatchObject({
      username: null,
      onboarding: {
        accountType: null,
        status: "pending",
        completedAt: null,
      },
      profile: { weight: null, height: null },
    });
  });

  test("expone el tipo de cuenta profesional durante el onboarding", () => {
    const user = new User({
      name: "Coach Nuevo",
      email: "coach@example.com",
      username: "coach_nuevo",
      password: "Rirfit1234",
      role: "Entrenador",
      onboarding: { accountType: "coach", status: "pending" },
    });

    expect(user.toSafeJSON()).toMatchObject({
      role: "Entrenador",
      onboarding: { accountType: "coach", status: "pending" },
    });
  });

  test("normaliza y expone el nombre de usuario", () => {
    const user = new User({
      name: "Atleta",
      email: "usuario@example.com",
      username: "Juan_Fit",
      password: "Rirfit1234",
    });

    expect(user.toSafeJSON().username).toBe("juan_fit");
  });

  test("mantiene completas las cuentas heredadas sin estado explicito", () => {
    const user = new User({
      name: "Atleta Existente",
      email: "existente@example.com",
      password: "Rirfit1234",
      role: "Cliente",
    });

    expect(user.toSafeJSON().onboarding.status).toBe("complete");
  });
});
