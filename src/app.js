import cors from "cors";
import express from "express";
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
import Photo from "./models/Photo.js";

const app = express();
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
      Math.random() * 1e9
    )}${path.extname(file.originalname)}`;
    cb(null, unique);
  },
});
const upload = multer({ storage });

const allowedOrigins = [
  "https://gym-frontend-t65c.onrender.com",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:3000",
];
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions), (_req, res) => res.sendStatus(200));
app.use(
  compression({
    level: 6,
    threshold: 1024, // comprime respuestas mayores a 1KB
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));
app.use("/uploads", express.static(uploadsDir));

// Upload endpoint (multipart) to ensure availability even if router is cached old version
app.post(
  "/api/photos/upload",
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const { date, label, type, sessionId, ownerId } = req.body;
      const baseUrl =
        process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
      const url = `${baseUrl}/uploads/${req.file.filename}`;
      const photo = await Photo.create({
        date: date || new Date().toISOString().slice(0, 10),
        label: label || "",
        type: type || "gym",
        sessionId: sessionId || null,
        ownerId: ownerId || null,
        url,
      });
      res.status(201).json(photo);
    } catch (err) {
      next(err);
    }
  }
);

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/exercises", exercisesRoutes);
app.use("/api/routines", routinesRoutes);
app.use("/api/sessions", sessionsRoutes);
app.use("/api/photos", photosRoutes);
app.use("/api/trainings", trainingsRoutes);
app.use("/api/preferences", preferencesRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});

export default app;

