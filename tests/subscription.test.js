import {
  canStartPremiumTrial,
  getEffectiveSubscription,
  getEntitlements,
  hasPremiumFeature,
  PREMIUM_FEATURES,
} from "../src/utils/subscription.js";

const now = new Date("2026-08-17T12:00:00.000Z");

describe("subscription", () => {
  test("habilita las funciones del plan Coach Pro activo", () => {
    const user = {
      role: "Entrenador",
      subscription: {
        plan: "coach_pro",
        status: "active",
        currentPeriodEnd: "2026-09-17T12:00:00.000Z",
      },
    };

    expect(getEffectiveSubscription(user, now)).toMatchObject({
      effectivePlan: "coach_pro",
      isPremium: true,
    });
    expect(getEntitlements(user, now)).toEqual(
      expect.arrayContaining([
        PREMIUM_FEATURES.COACH_PORTFOLIO,
        PREMIUM_FEATURES.WEEKLY_REPORTS,
        PREMIUM_FEATURES.ASSISTED_PLANS,
      ]),
    );
  });

  test("degrada una prueba vencida a Free", () => {
    const user = {
      role: "Cliente",
      subscription: {
        plan: "athlete_pro",
        status: "trialing",
        trialEndsAt: "2026-08-16T12:00:00.000Z",
      },
    };

    expect(getEffectiveSubscription(user, now)).toMatchObject({
      status: "expired",
      effectivePlan: "free",
      isPremium: false,
    });
    expect(hasPremiumFeature(user, PREMIUM_FEATURES.DAILY_CHECKIN, now)).toBe(
      false,
    );
  });

  test("no conserva permisos incompatibles despues de cambiar de rol", () => {
    const user = {
      role: "Cliente",
      subscription: {
        plan: "coach_pro",
        status: "active",
        currentPeriodEnd: "2026-09-17T12:00:00.000Z",
      },
    };

    expect(getEntitlements(user, now)).toEqual([]);
  });

  test("admin y cuentas demo mantienen acceso completo", () => {
    expect(
      hasPremiumFeature(
        { role: "Admin" },
        PREMIUM_FEATURES.ASSISTED_PLANS,
        now,
      ),
    ).toBe(true);
    expect(
      hasPremiumFeature(
        { role: "Cliente", isDemo: true },
        PREMIUM_FEATURES.DAILY_CHECKIN,
        now,
      ),
    ).toBe(true);
  });

  test("permite una sola prueba autoservicio por cuenta", () => {
    const eligible = {
      role: "Cliente",
      subscription: { plan: "free", status: "active", trialUsedAt: null },
    };
    const used = {
      role: "Cliente",
      subscription: {
        plan: "free",
        status: "active",
        trialUsedAt: "2026-08-01T12:00:00.000Z",
      },
    };

    expect(canStartPremiumTrial(eligible, now)).toBe(true);
    expect(canStartPremiumTrial(used, now)).toBe(false);
    expect(canStartPremiumTrial({ role: "Admin" }, now)).toBe(false);
  });
});
