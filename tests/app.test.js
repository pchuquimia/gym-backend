import request from "supertest";
import app from "../src/app.js";

describe("API shell", () => {
  test("GET /api/health confirma disponibilidad", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers["server-timing"]).toMatch(/total;dur=/);
    expect(response.headers["x-response-time"]).toMatch(/ms$/);
  });

  test("el endpoint publico de arquitectura no expone topologia en produccion", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const response = await request(app).get("/api/health/architecture");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
      expect(response.body).not.toHaveProperty("topology");
      expect(response.body).not.toHaveProperty("cache");
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  test("el endpoint publico de arquitectura tampoco expone topologia en staging", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "staging";
    try {
      const response = await request(app).get("/api/health/architecture");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  test("una ruta desconocida responde 404 en JSON", async () => {
    const response = await request(app).get("/api/no-existe");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/Ruta no encontrada/);
  });

  test("publica el estado de la demo sin exponer credenciales", async () => {
    const previous = process.env.DEMO_MODE;
    process.env.DEMO_MODE = "false";
    const response = await request(app).get("/api/auth/demo/status");
    if (previous === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = previous;

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enabled: false, roles: [] });
  });

  test("el reenvio de verificacion falla claramente si correo esta deshabilitado", async () => {
    const previousProvider = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = "disabled";
    try {
      const response = await request(app)
        .post("/api/auth/resend-verification")
        .send({ email: "persona@example.com" });
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("EMAIL_NOT_CONFIGURED");
    } finally {
      if (previousProvider === undefined) delete process.env.EMAIL_PROVIDER;
      else process.env.EMAIL_PROVIDER = previousProvider;
    }
  });

  test("el acceso con Google falla claramente si no esta configurado", async () => {
    const previousClientId = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    try {
      const response = await request(app)
        .post("/api/auth/google")
        .send({ credential: "x".repeat(100) });
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("GOOGLE_AUTH_NOT_CONFIGURED");
    } finally {
      if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = previousClientId;
    }
  });

  test("el acceso con Facebook falla claramente si no esta configurado", async () => {
    const previous = {
      appId: process.env.FACEBOOK_APP_ID,
      appSecret: process.env.FACEBOOK_APP_SECRET,
      callbackUrl: process.env.FACEBOOK_CALLBACK_URL,
    };
    delete process.env.FACEBOOK_APP_ID;
    delete process.env.FACEBOOK_APP_SECRET;
    delete process.env.FACEBOOK_CALLBACK_URL;
    try {
      const response = await request(app).get("/api/auth/facebook");
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("FACEBOOK_AUTH_NOT_CONFIGURED");
    } finally {
      if (previous.appId === undefined) delete process.env.FACEBOOK_APP_ID;
      else process.env.FACEBOOK_APP_ID = previous.appId;
      if (previous.appSecret === undefined)
        delete process.env.FACEBOOK_APP_SECRET;
      else process.env.FACEBOOK_APP_SECRET = previous.appSecret;
      if (previous.callbackUrl === undefined)
        delete process.env.FACEBOOK_CALLBACK_URL;
      else process.env.FACEBOOK_CALLBACK_URL = previous.callbackUrl;
    }
  });

  test("el callback de Facebook vuelve al frontend local durante desarrollo", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFacebookClientUrl = process.env.FACEBOOK_CLIENT_URL;
    process.env.NODE_ENV = "development";
    delete process.env.FACEBOOK_CLIENT_URL;
    try {
      const response = await request(app)
        .get("/api/auth/facebook/callback?state=invalid")
        .set("Host", "localhost:4000");

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(
        "http://localhost:5173/?facebook_error=invalid_state",
      );
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousFacebookClientUrl === undefined)
        delete process.env.FACEBOOK_CLIENT_URL;
      else process.env.FACEBOOK_CLIENT_URL = previousFacebookClientUrl;
    }
  });

  test("rechaza una preferencia de correo que no sea booleana", async () => {
    const response = await request(app).post("/api/auth/register").send({
      name: "Atleta Nuevo",
      email: "atleta@example.com",
      password: "Rirfit1234",
      confirmPassword: "Rirfit1234",
      emailMarketingConsent: "quizas",
    });

    expect(response.status).toBe(400);
    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "emailMarketingConsent" }),
      ]),
    );
  });

  test("rechaza identificadores de acceso con formato invalido", async () => {
    const response = await request(app).post("/api/auth/login").send({
      identifier: "usuario con espacios",
      password: "Rirfit1234",
    });

    expect(response.status).toBe(401);
  });
});
