import mongoose from "mongoose";

export const getMongoConnectionOptions = () => {
  const configuredPoolSize = Number(process.env.MONGO_MAX_POOL_SIZE || 10);
  return {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: 15_000,
    maxIdleTimeMS: 30_000,
    heartbeatFrequencyMS: 10_000,
    maxPoolSize: Number.isFinite(configuredPoolSize)
      ? Math.max(2, configuredPoolSize)
      : 10,
    minPoolSize: 0,
    retryReads: true,
    retryWrites: true,
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
