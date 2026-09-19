import dotenv from "dotenv";
import { fileURLToPath } from "url";

export const backendEnvPath = fileURLToPath(
  new URL("../../.env", import.meta.url),
);

export const loadBackendEnvironment = (envPath = backendEnvPath) =>
  dotenv.config({
    path: envPath,
    override: false,
  });
