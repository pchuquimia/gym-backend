import request from "supertest";
import app from "../src/app.js";

describe("API shell", () => {
  test("GET /api/health confirma disponibilidad", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
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
});
