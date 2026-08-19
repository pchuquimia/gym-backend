import { loadBackendEnvironment } from "./config/loadEnv.js";

loadBackendEnvironment();

const [{ default: app }, { connectDB }] = await Promise.all([
  import("./app.js"),
  import("./config/db.js"),
]);
const { reportDeploymentTopology } =
  await import("./utils/deploymentTopology.js");
const { startCodexImageAutoQueue } =
  await import("./services/exerciseCodexAutoQueueService.js");

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/gym";

const requiredEnv = ["JWT_SECRET"];
if (process.env.NODE_ENV === "production") {
  requiredEnv.push("MONGO_URI", "CLIENT_URL");
}

for (const key of requiredEnv) {
  if (!String(process.env[key] || "").trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

async function start() {
  reportDeploymentTopology();
  await connectDB(MONGO_URI);
  startCodexImageAutoQueue();
  app.listen(PORT, () => {
    console.log(`API escuchando en puerto ${PORT}`);
  });
}

start();
