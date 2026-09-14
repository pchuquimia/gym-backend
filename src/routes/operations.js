import { Router } from "express";
import { authorizeRoles, protect } from "../middleware/authMiddleware.js";
import {
  getPerformanceSnapshot,
  resetPerformanceMetrics,
} from "../middleware/performanceTiming.js";
import { getCacheStatus } from "../services/cacheService.js";

const router = Router();

router.use(protect, authorizeRoles("Admin"));

router.get("/performance", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    performance: getPerformanceSnapshot(),
    cache: getCacheStatus(),
  });
});

router.delete("/performance", (_req, res) => {
  resetPerformanceMetrics();
  res.set("Cache-Control", "no-store");
  res.json({ ok: true });
});

export default router;
