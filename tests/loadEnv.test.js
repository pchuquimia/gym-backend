import fs from "fs";
import os from "os";
import path from "path";
import {
  backendEnvPath,
  loadBackendEnvironment,
} from "../src/config/loadEnv.js";

describe("backend environment", () => {
  test("resuelve el archivo .env desde la raiz del backend", () => {
    expect(backendEnvPath).toBe(path.resolve(process.cwd(), ".env"));
  });

  test("carga variables de un archivo sin sobrescribir el entorno existente", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rirfit-env-test-"));
    const envPath = path.join(tempDir, ".env");
    const variable = "RIRFIT_TEST_ENV_LOADER";
    const previousValue = process.env[variable];

    try {
      fs.writeFileSync(envPath, `${variable}=desde_archivo\n`);
      delete process.env[variable];

      expect(loadBackendEnvironment(envPath).error).toBeUndefined();
      expect(process.env[variable]).toBe("desde_archivo");

      process.env[variable] = "valor_existente";
      expect(loadBackendEnvironment(envPath).error).toBeUndefined();
      expect(process.env[variable]).toBe("valor_existente");
    } finally {
      if (previousValue === undefined) delete process.env[variable];
      else process.env[variable] = previousValue;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
