import mongoose from "mongoose";

mongoose.set("runValidators", true);
mongoose.set("strictQuery", true);

export const getMongoConnectionOptions = () => {
  const configuredPoolSize = Number(process.env.MONGO_MAX_POOL_SIZE || 10);
  const configuredMinPoolSize = Number(process.env.MONGO_MIN_POOL_SIZE || 2);
  const maxPoolSize = Number.isFinite(configuredPoolSize)
    ? Math.max(2, configuredPoolSize)
    : 10;
  const configuredDatabase = String(process.env.MONGO_DB_NAME || "").trim();
  if (configuredDatabase && !/^[A-Za-z0-9_-]+$/.test(configuredDatabase)) {
    throw new Error(
      "MONGO_DB_NAME solo puede contener letras, numeros, guiones y guiones bajos",
    );
  }
  return {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: 15_000,
    maxIdleTimeMS: 60_000,
    heartbeatFrequencyMS: 10_000,
    waitQueueTimeoutMS: 5_000,
    appName: "rirfit-api",
    maxPoolSize,
    minPoolSize: Number.isFinite(configuredMinPoolSize)
      ? Math.max(0, Math.min(configuredMinPoolSize, maxPoolSize))
      : 2,
    retryReads: true,
    retryWrites: true,
    ...(configuredDatabase ? { dbName: configuredDatabase } : {}),
  };
};

export async function connectDB(uri) {
  try {
    await mongoose.connect(uri, getMongoConnectionOptions());
    console.log("MongoDB connected");
  } catch (err) {
    console.error("Mongo connection error", err.message);
    process.exit(1);
  }
}
