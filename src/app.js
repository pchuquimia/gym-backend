import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import compression from "compression";
import exercisesRoutes from "./routes/exercises.js";
import routinesRoutes from "./routes/routines.js";
import sessionsRoutes from "./routes/sessions.js";
import photosRoutes from "./routes/photos.js";
import trainingsRoutes from "./routes/trainings.js";
import trainingDraftsRoutes from "./routes/trainingDrafts.js";
import preferencesRoutes from "./routes/preferences.js";
import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
import nutritionRoutes from "./routes/nutrition.js";
import messagesRoutes from "./routes/messages.js";
import coachRoutes from "./routes/coach.js";
import plansRoutes from "./routes/plans.js";
import planTemplatesRoutes from "./routes/planTemplates.js";
import analyticsRoutes from "./routes/analytics.js";
import weighInsRoutes from "./routes/weighIns.js";
import hydrationRoutes from "./routes/hydration.js";
import checkInsRoutes from "./routes/checkIns.js";
import billingRoutes from "./routes/billing.js";
import dashboardRoutes from "./routes/dashboard.js";
import measurementsRoutes from "./routes/measurements.js";
import assessmentsRoutes from "./routes/assessments.js";
import notificationsRoutes from "./routes/notifications.js";
import operationsRoutes from "./routes/operations.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { performanceTiming } from "./middleware/performanceTiming.js";
import { getCacheStatus } from "./services/cacheService.js";
import { getDeploymentHealth } from "./utils/deploymentTopology.js";
import { canExposeArchitectureDetails } from "./config/security.js";
import Photo from "./models/Photo.js";
import { isTrustedOrigin } from "./config/requestOrigins.js";
import { csrfProtection, issueCsrfToken } from "./middleware/csrfProtection.js";
import { requestId } from "./middleware/requestId.js";

const app = express();
app.set("trust proxy", 1);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const isDev = process.env.NODE_ENV !== "production";
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    return cb(null, isTrustedOrigin(origin));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  exposedHeaders: [
    "Server-Timing",
    "X-Response-Time",
    "X-Data-Cache",
    "X-Intelligence-Source",
    "ETag",
    "X-Catalog-Version",
    "X-Request-Id",
  ],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(requestId);
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  }),
);
app.use(cors(corsOptions));
app.options("*", cors(corsOptions), (_req, res) => res.sendStatus(200));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 500,
    skip: () => isDev,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Demasiadas solicitudes. Espera un momento." },
  }),
);
app.use(
  compression({
    level: 6,
    threshold: 1024, // comprime respuestas mayores a 1KB
  }),
);
app.use(cookieParser());
app.use(csrfProtection);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(performanceTiming);
morgan.token("safe-url", (req) => req.path);
app.use(
  morgan(
    isDev
      ? "dev"
      : ":method :safe-url :status :response-time ms :res[content-length] :res[x-request-id]",
  ),
);
app.use("/uploads/:filename", async (req, res, next) => {
  try {
    const filename = path.basename(String(req.params.filename || ""));
    if (!filename || filename !== req.params.filename)
      return res.sendStatus(404);
    const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const privatePhoto = await Photo.exists({
      $or: [
        { localFilename: filename },
        { url: { $regex: `/uploads/${escaped}(?:\\?|$)` } },
      ],
    });
    if (privatePhoto) return res.sendStatus(404);
    return next();
  } catch (error) {
    return next(error);
  }
});
app.use("/uploads", express.static(uploadsDir));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/auth/csrf", issueCsrfToken);
app.get("/api/health/architecture", async (_req, res, next) => {
  if (!canExposeArchitectureDetails()) {
    return res.json({ ok: true });
  }
  try {
    res.json({
      ok: true,
      topology: await getDeploymentHealth(),
      cache: getCacheStatus(),
    });
  } catch (error) {
    next(error);
  }
});
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/coach", coachRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/nutrition", nutritionRoutes);
app.use("/api/plans", plansRoutes);
app.use("/api/plan-templates", planTemplatesRoutes);
app.use("/api/exercises", exercisesRoutes);
app.use("/api/routines", routinesRoutes);
app.use("/api/sessions", sessionsRoutes);
app.use("/api/photos", photosRoutes);
app.use("/api/trainings", trainingsRoutes);
app.use("/api/training-drafts", trainingDraftsRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/preferences", preferencesRoutes);
app.use("/api/weigh-ins", weighInsRoutes);
app.use("/api/hydration", hydrationRoutes);
app.use("/api/check-ins", checkInsRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/measurements", measurementsRoutes);
app.use("/api/assessments", assessmentsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/operations", operationsRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
