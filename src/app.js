import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import compression from "compression";
import exercisesRoutes from "./routes/exercises.js";
import routinesRoutes from "./routes/routines.js";
import sessionsRoutes from "./routes/sessions.js";
import photosRoutes from "./routes/photos.js";
import trainingsRoutes from "./routes/trainings.js";
import preferencesRoutes from "./routes/preferences.js";
import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
import Photo from "./models/Photo.js";
import { protect } from "./middleware/authMiddleware.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import {
  uploadPhotoToCloudinary,
  removeLocalFile,
  isCloudinaryReady,
} from "./utils/photoUpload.js";

const app = express();
app.set("trust proxy", 1);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(
      Math.random() * 1e9,
    )}${path.extname(file.originalname)}`;
    cb(null, unique);
  },
});
const upload = multer({ storage });

const parseOrigins = (value = "") =>
  value
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);

const allowedOrigins = [
  ...parseOrigins(process.env.CLIENT_URL),
  ...parseOrigins(process.env.CLIENT_URLS),
  "https://gym-frontend-t65c.onrender.com",
  "https://gym-backend-1fod.onrender.com",
  "http://localhost:5173",
  "http://localhost:5175",
  "http://localhost:4173",
  "http://localhost:3000",
];
const localOriginPattern =
  /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/;
const isDev = process.env.NODE_ENV !== "production";
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const normalizedOrigin = origin.replace(/\/$/, "");
    if (allowedOrigins.includes(normalizedOrigin)) return cb(null, true);
    if (isDev && localOriginPattern.test(normalizedOrigin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 200,
};

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
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
app.use(
  compression({
    level: 6,
    threshold: 1024, // comprime respuestas mayores a 1KB
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(morgan("dev"));
app.use("/uploads", express.static(uploadsDir));

// Upload endpoint (multipart) to ensure availability even if router is cached old version
app.post(
  "/api/photos/upload",
  protect,
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const { date, label, type, sessionId } = req.body;
      const baseUrl =
        process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
      let uploaded = null;
      if (isCloudinaryReady) {
        try {
          uploaded = await uploadPhotoToCloudinary(req.file.path);
        } catch (err) {
          console.error("Cloudinary upload failed", err);
          return res.status(500).json({ error: "Cloudinary upload failed" });
        }
      }
      if (uploaded) await removeLocalFile(req.file.path);
      const url = uploaded?.url || `${baseUrl}/uploads/${req.file.filename}`;
      const photo = await Photo.create({
        date: date || new Date().toISOString().slice(0, 10),
        label: label || "",
        type: type || "gym",
        sessionId: sessionId || null,
        ownerId: req.user.id,
        url,
        publicId: uploaded?.publicId || "",
      });
      res.status(201).json(photo);
    } catch (err) {
      next(err);
    }
  },
);

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/exercises", exercisesRoutes);
app.use("/api/routines", routinesRoutes);
app.use("/api/sessions", sessionsRoutes);
app.use("/api/photos", photosRoutes);
app.use("/api/trainings", trainingsRoutes);
app.use("/api/preferences", preferencesRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
