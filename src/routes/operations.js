import { Router } from "express";
import { authorizeRoles, protect } from "../middleware/authMiddleware.js";
import {
  getPerformanceSnapshot,
  resetPerformanceMetrics,
} from "../middleware/performanceTiming.js";
import { getCacheStatus } from "../services/cacheService.js";
import { getAuthenticationUserCacheStatus } from "../services/authenticationUserCache.js";
import { getDeploymentHealth } from "../utils/deploymentTopology.js";

const router = Router();

router.use(protect, authorizeRoles("Admin"));

router.get("/performance", async (_req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({
      performance: getPerformanceSnapshot(),
      cache: getCacheStatus(),
      authenticationCache: getAuthenticationUserCacheStatus(),
      topology: await getDeploymentHealth(),
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/performance", (_req, res) => {
  resetPerformanceMetrics();
  res.set("Cache-Control", "no-store");
  res.json({ ok: true });
});

export default router;
