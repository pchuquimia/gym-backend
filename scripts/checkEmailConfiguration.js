import { loadBackendEnvironment } from "../src/config/loadEnv.js";

loadBackendEnvironment();

const { getEmailStatus } = await import("../src/config/email.js");
const { verifyEmailTransport } = await import("../src/utils/email.js");

const status = getEmailStatus();
if (!status.configured) {
  const missing = status.missing.length
    ? ` Faltan: ${status.missing.join(", ")}.`
    : "";
  throw new Error(`El correo no esta configurado.${missing}`);
}

await verifyEmailTransport();
console.log(`Conexion de correo verificada (${status.provider}).`);
