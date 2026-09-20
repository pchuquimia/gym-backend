import { validationResult } from "express-validator";
import authRouter from "../src/routes/auth.js";

const onboardingRoute = authRouter.stack.find(
  (layer) => layer.route?.path === "/onboarding" && layer.route.methods.patch,
);
const validators = onboardingRoute.route.stack
  .map((layer) => layer.handle)
  .filter((middleware) => typeof middleware.run === "function");

const validateOnboarding = async (body) => {
  const req = { body: { ...body } };
  for (const validator of validators) await validator.run(req);
  return validationResult(req).array();
};

const profile = {
  name: "Liz",
  username: "liz",
  goal: "volumen",
  experienceLevel: "beginner",
  weeklyFrequency: 5,
  weight: 59,
  height: 164,
};

describe("validación del perfil inicial", () => {
  test("acepta el valor vacío enviado por clientes antiguos sin cuestionario", async () => {
    expect(
      await validateOnboarding({ ...profile, intakeSettingsVersion: "" }),
    ).toEqual([]);
  });

  test("sigue rechazando versiones de evaluación demasiado largas", async () => {
    const errors = await validateOnboarding({
      ...profile,
      intakeSettingsVersion: "x".repeat(81),
    });
    expect(errors).toEqual([
      expect.objectContaining({ path: "intakeSettingsVersion" }),
    ]);
  });
});
