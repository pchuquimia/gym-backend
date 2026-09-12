import { Router } from "express";
import { protect } from "../middleware/authMiddleware.js";
import UserNotification from "../models/UserNotification.js";

const router = Router();
router.use(protect);

router.get("/", async (req, res, next) => {
  try {
    const notifications = await UserNotification.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    res.set("Cache-Control", "no-store");
    res.json({
      notifications,
      unread: notifications.filter((item) => !item.readAt).length,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/read", async (req, res, next) => {
  try {
    await UserNotification.updateMany(
      { userId: req.user.id, readAt: null },
      { $set: { readAt: new Date() } },
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
