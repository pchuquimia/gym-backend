import path from "path";
import {
  backendEnvPath,
  loadBackendEnvironment,
} from "../src/config/loadEnv.js";

describe("backend environment", () => {
  test("resuelve el archivo .env desde la raiz del backend", () => {
    expect(path.basename(backendEnvPath)).toBe(".env");
    expect(path.basename(path.dirname(backendEnvPath))).toBe("backend");
  });

  test("carga JWT_SECRET aunque el proceso se inicie desde otro directorio", () => {
    const previousSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;

    const result = loadBackendEnvironment();

    expect(result.error).toBeUndefined();
    expect(process.env.JWT_SECRET).toBeTruthy();
    if (previousSecret) process.env.JWT_SECRET = previousSecret;
  });
});
