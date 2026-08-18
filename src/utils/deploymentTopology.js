import mongoose from "mongoose";
import { performance } from "node:perf_hooks";

const normalizeRegion = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
let latencyCache = null;

export const getDeploymentTopology = () => {
  const backendRegion = normalizeRegion(
    process.env.BACKEND_REGION || process.env.RENDER_REGION,
  );
  const databaseRegion = normalizeRegion(process.env.MONGO_REGION);
  return {
    backendRegion: backendRegion || null,
    databaseRegion: databaseRegion || null,
    regionAligned:
      backendRegion && databaseRegion ? backendRegion === databaseRegion : null,
  };
};

export const reportDeploymentTopology = () => {
  const topology = getDeploymentTopology();
  if (topology.regionAligned === false) {
    console.warn(
      `[topology] Backend (${topology.backendRegion}) y MongoDB (${topology.databaseRegion}) estan en regiones distintas`,
    );
  } else if (topology.regionAligned === null) {
    console.warn(
      "[topology] Configura BACKEND_REGION y MONGO_REGION para verificar latencia entre servicios",
    );
  }
  return topology;
};

export const getDeploymentHealth = async () => {
  const topology = getDeploymentTopology();
  if (latencyCache?.expiresAt > Date.now()) {
    return { ...topology, databaseRoundTripMs: latencyCache.value };
  }
  if (mongoose.connection.readyState !== 1) {
    return { ...topology, databaseRoundTripMs: null };
  }
  const startedAt = performance.now();
  await mongoose.connection.db.admin().ping();
  const databaseRoundTripMs =
    Math.round((performance.now() - startedAt) * 10) / 10;
  latencyCache = {
    value: databaseRoundTripMs,
    expiresAt: Date.now() + 60 * 1000,
  };
  return {
    ...topology,
    databaseRoundTripMs,
    latencyStatus:
      databaseRoundTripMs <= 50
        ? "optimal"
        : databaseRoundTripMs <= 120
          ? "acceptable"
          : "review-region",
  };
};
