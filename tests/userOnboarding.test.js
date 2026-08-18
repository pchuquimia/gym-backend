import User from "../src/models/User.js";

describe("user onboarding", () => {
  test("expone el estado pendiente y evita medidas corporales ficticias", () => {
    const user = new User({
      name: "Atleta Nuevo",
      email: "nuevo@example.com",
      password: "Apex1234",
      role: "Cliente",
      onboarding: { status: "pending" },
      profile: { weight: null, height: null },
    });

    expect(user.toSafeJSON()).toMatchObject({
      onboarding: { status: "pending", completedAt: null },
      profile: { weight: null, height: null },
    });
  });

  test("mantiene completas las cuentas heredadas sin estado explicito", () => {
    const user = new User({
      name: "Atleta Existente",
      email: "existente@example.com",
      password: "Apex1234",
      role: "Cliente",
    });

    expect(user.toSafeJSON().onboarding.status).toBe("complete");
  });
});
