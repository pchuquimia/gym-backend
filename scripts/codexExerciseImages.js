import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { loadBackendEnvironment } from "../src/config/loadEnv.js";

loadBackendEnvironment();

const [{ getMongoConnectionOptions }, { default: CodexImageRequest }] =
  await Promise.all([
    import("../src/config/db.js"),
    import("../src/models/CodexImageRequest.js"),
  ]);

const usage = () => {
  console.log(`Uso:
  npm run codex:images -- list
  npm run codex:images -- claim [requestId]
  npm run codex:images -- complete <requestId> <ruta-imagen>
  npm run codex:images -- fail <requestId> <motivo>`);
};

const serialize = (request) =>
  request
    ? {
        id: String(request._id),
        exerciseId: request.exerciseId,
        exerciseName: request.exerciseName,
        referenceImage: request.referenceImage,
        instruction: request.instruction,
        prompt: request.prompt,
        status: request.status,
        result: request.result,
        error: request.error,
        createdAt: request.createdAt,
      }
    : null;

const connect = async () => {
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/gym";
  await mongoose.connect(uri, getMongoConnectionOptions());
};

const list = async () => {
  const requests = await CodexImageRequest.find({
    status: { $in: ["pending", "processing", "ready", "failed"] },
  })
    .sort({ createdAt: 1 })
    .limit(100)
    .lean();
  console.log(JSON.stringify({ requests: requests.map(serialize) }, null, 2));
};

const claim = async (requestId) => {
  const filter = requestId
    ? { _id: requestId, status: { $in: ["pending", "processing"] } }
    : { status: "pending" };
  const request = await CodexImageRequest.findOneAndUpdate(
    filter,
    { $set: { status: "processing", claimedAt: new Date(), error: "" } },
    { new: true, sort: { createdAt: 1 } },
  ).lean();
  console.log(JSON.stringify({ request: serialize(request) }, null, 2));
};

const complete = async (requestId, filePath) => {
  if (!requestId || !filePath) {
    throw new Error("complete requiere requestId y ruta-imagen");
  }
  const absolutePath = path.resolve(filePath);
  const stats = await fs.stat(absolutePath);
  if (!stats.isFile() || stats.size === 0 || stats.size > 10 * 1024 * 1024) {
    throw new Error("La propuesta debe ser un archivo de imagen de hasta 10 MB");
  }
  const request = await CodexImageRequest.findOne({
    _id: requestId,
    status: { $in: ["pending", "processing", "failed"] },
  });
  if (!request) {
    throw new Error("No se encontro una solicitud procesable");
  }

  const extension = path.extname(absolutePath).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(extension)) {
    throw new Error("La propuesta debe ser JPG, PNG o WebP");
  }
  const relativeFilename = `codex-proposals/${request._id}${extension}`;
  const uploadsDirectory = path.resolve("uploads");
  const destination = path.resolve(uploadsDirectory, relativeFilename);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(absolutePath, destination);
  const baseUrl = String(
    process.env.CODEX_IMAGE_BASE_URL ||
      `http://localhost:${process.env.PORT || 4000}`,
  ).replace(/\/$/, "");
  const uploaded = {
    url: `${baseUrl}/uploads/${relativeFilename.replace(/\\/g, "/")}`,
    publicId: "",
    storage: "local",
    filename: relativeFilename.replace(/\\/g, "/"),
    bytes: stats.size,
    width: 0,
    height: 0,
    format: extension.slice(1).replace("jpeg", "jpg"),
  };
  request.status = "ready";
  request.result = uploaded;
  request.completedAt = new Date();
  request.error = "";
  await request.save();
  console.log(JSON.stringify({ request: serialize(request.toObject()) }, null, 2));
};

const fail = async (requestId, message) => {
  if (!requestId) throw new Error("fail requiere requestId");
  const request = await CodexImageRequest.findByIdAndUpdate(
    requestId,
    {
      $set: {
        status: "failed",
        error: String(message || "Codex no pudo generar la propuesta").slice(
          0,
          2000,
        ),
        completedAt: new Date(),
      },
    },
    { new: true },
  ).lean();
  if (!request) throw new Error("Solicitud no encontrada");
  console.log(JSON.stringify({ request: serialize(request) }, null, 2));
};

const run = async () => {
  const [command = "list", first, ...rest] = process.argv.slice(2);
  if (!["list", "claim", "complete", "fail"].includes(command)) {
    usage();
    process.exitCode = 1;
    return;
  }
  await connect();
  if (command === "list") await list();
  if (command === "claim") await claim(first);
  if (command === "complete") await complete(first, rest[0]);
  if (command === "fail") await fail(first, rest.join(" "));
};

try {
  await run();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
