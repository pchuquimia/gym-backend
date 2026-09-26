import mongoose from "mongoose";
import { loadBackendEnvironment } from "../src/config/loadEnv.js";
import User from "../src/models/User.js";
import {
  createDemoWorkspace,
  deleteDemoWorkspace,
} from "../src/services/demoWorkspaceService.js";

loadBackendEnvironment();

const email = String(process.env.SALES_DEMO_EMAIL || "")
  .trim()
  .toLowerCase();
const password = String(process.env.SALES_DEMO_PASSWORD || "");
const coachName = String(
  process.env.SALES_DEMO_COACH_NAME || "Coach RIRFIT",
).trim();
const requestedHours = Number(process.env.SALES_DEMO_HOURS || 168);
const lifetimeHours = Math.min(168, Math.max(1, requestedHours));

if (process.env.SALES_DEMO_CONFIRM !== "create-guided-demo") {
  throw new Error(
    "Configura SALES_DEMO_CONFIRM=create-guided-demo para crear la cuenta.",
  );
}
if (!email || !email.includes("@")) {
  throw new Error("Configura SALES_DEMO_EMAIL con un correo valido.");
}
if (password.length < 12) {
  throw new Error("SALES_DEMO_PASSWORD debe tener al menos 12 caracteres.");
}

let workspaceId = "";

try {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10_000,
  });

  const existing = await User.findOne({ email }).lean();
  if (existing && (!existing.isDemo || !existing.demoWorkspaceId)) {
    throw new Error(
      "El correo ya pertenece a una cuenta que no es demo. Usa otro correo.",
    );
  }
  if (existing?.demoWorkspaceId) {
    await deleteDemoWorkspace(existing.demoWorkspaceId);
  }

  const result = await createDemoWorkspace("coach");
  workspaceId = result.workspaceId;
  const expiresAt = new Date(Date.now() + lifetimeHours * 60 * 60 * 1000);

  await User.updateMany(
    { demoWorkspaceId: workspaceId },
    { $set: { demoExpiresAt: expiresAt } },
  );

  const coach = await User.findById(result.user._id).select("+password");
  coach.name = coachName;
  coach.email = email;
  coach.password = password;
  coach.subscription = {
    plan: "coach_pro",
    status: "active",
    activatedAt: new Date(),
    currentPeriodEnd: expiresAt,
    provider: "manual",
  };
  await coach.save();

  const athletes = await User.find({
    demoWorkspaceId: workspaceId,
    role: "Cliente",
  })
    .sort({ name: 1 })
    .select("name")
    .lean();

  console.log(
    JSON.stringify(
      {
        created: true,
        url: process.env.CLIENT_URL || "https://rirfit.com",
        email,
        password,
        expiresAt: expiresAt.toISOString(),
        athletes: athletes.map((athlete) => athlete.name),
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (workspaceId) await deleteDemoWorkspace(workspaceId);
  throw error;
} finally {
  await mongoose.disconnect();
}
