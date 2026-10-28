import { Router } from "express";
import mongoose from "mongoose";
import { body, param, query } from "express-validator";
import rateLimit from "express-rate-limit";
import { protect } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import User from "../models/User.js";
import CoachMessage from "../models/CoachMessage.js";

const router = Router();
router.use(protect);
router.use((_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});
const peerFields = "name role profile.avatarPhotoId assignedTrainerId";
const demoScope = (user) =>
  user.isDemo
    ? { isDemo: true, demoWorkspaceId: user.demoWorkspaceId }
    : { isDemo: { $ne: true } };

const peersFor = async (user, peerId) => {
  // Permissions and relationships must reflect the current database state.
  const actor = await User.findOne(
    { _id: user.id, isActive: true },
    "role assignedTrainerId",
  ).lean();
  if (!actor || actor.role !== user.role) return [];
  if (actor.role === "Cliente") {
    if (
      !actor.assignedTrainerId ||
      (peerId && peerId !== String(actor.assignedTrainerId))
    )
      return [];
    return User.find(
      {
        _id: actor.assignedTrainerId,
        role: { $in: ["Admin", "Entrenador"] },
        isActive: true,
        ...demoScope(user),
      },
      peerFields,
    ).lean();
  }
  if (!["Entrenador", "Admin"].includes(actor.role)) return [];
  return User.find(
    {
      ...(peerId ? { _id: peerId } : {}),
      role: "Cliente",
      assignedTrainerId: user.id,
      isActive: true,
      ...demoScope(user),
    },
    peerFields,
  ).lean();
};
const authorizeConversation = async (req, res, next) => {
  try {
    const [peer] = await peersFor(req.user, req.params.peerId);
    if (!peer)
      return res
        .status(403)
        .json({
          error:
            "Esta conversación requiere una vinculación activa entre coach y alumno",
          code: "COACH_RELATIONSHIP_REQUIRED",
        });
    req.messagePeer = peer;
    req.messagePair =
      req.user.role === "Cliente"
        ? { coachId: String(peer._id), athleteId: req.user.id }
        : { coachId: req.user.id, athleteId: String(peer._id) };
    next();
  } catch (error) {
    next(error);
  }
};

router.get("/", async (req, res, next) => {
  try {
    const peers = await peersFor(req.user);
    if (!peers.length) return res.json({ conversations: [] });
    const pairs = peers.map((peer) =>
      req.user.role === "Cliente"
        ? { coachId: String(peer._id), athleteId: req.user.id }
        : { coachId: req.user.id, athleteId: String(peer._id) },
    );
    const [latest, unread] = await Promise.all([
      CoachMessage.aggregate([
        { $match: { $or: pairs } },
        { $sort: { _id: -1 } },
        {
          $group: {
            _id: { coachId: "$coachId", athleteId: "$athleteId" },
            message: { $first: "$$ROOT" },
          },
        },
      ]),
      CoachMessage.aggregate([
        { $match: { recipientId: req.user.id, readAt: null, $or: pairs } },
        { $group: { _id: "$senderId", count: { $sum: 1 } } },
      ]),
    ]);
    const latestByPeer = new Map(
      latest.map(({ message }) => [
        message.coachId === req.user.id ? message.athleteId : message.coachId,
        message,
      ]),
    );
    const unreadByPeer = new Map(unread.map((row) => [row._id, row.count]));
    const conversations = peers
      .map((peer) => ({
        peer: {
          id: String(peer._id),
          name: peer.name,
          role: peer.role,
          avatarPhotoId: peer.profile?.avatarPhotoId || "",
        },
        lastMessage: latestByPeer.get(String(peer._id)) || null,
        unread: unreadByPeer.get(String(peer._id)) || 0,
      }))
      .sort(
        (a, b) =>
          String(b.lastMessage?._id || "").localeCompare(
            String(a.lastMessage?._id || ""),
          ) || a.peer.name.localeCompare(b.peer.name),
      );
    res.json({ conversations });
  } catch (error) {
    next(error);
  }
});

router.get(
  "/:peerId",
  [
    param("peerId").isMongoId(),
    query("before").optional().isMongoId(),
    validate,
  ],
  authorizeConversation,
  async (req, res, next) => {
    try {
      const messages = await CoachMessage.find({
        ...req.messagePair,
        ...(req.query.before
          ? { _id: { $lt: new mongoose.Types.ObjectId(req.query.before) } }
          : {}),
      })
        .sort({ _id: -1 })
        .limit(51)
        .lean();
      const hasMore = messages.length > 50;
      res.json({
        messages: messages.slice(0, 50).reverse(),
        hasMore,
        nextCursor: hasMore ? String(messages[49]._id) : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/:peerId",
  rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test",
    message: { error: "Espera un momento antes de enviar más mensajes" },
  }),
  [
    param("peerId").isMongoId(),
    body("text").isString().bail().trim().isLength({ min: 1, max: 2000 }),
    body("clientMessageId").isUUID(),
    validate,
  ],
  authorizeConversation,
  async (req, res, next) => {
    try {
      const filter = {
        senderId: req.user.id,
        clientMessageId: req.body.clientMessageId,
      };
      let message;
      try {
        message = await CoachMessage.findOneAndUpdate(
          filter,
          {
            $setOnInsert: {
              ...req.messagePair,
              ...filter,
              recipientId: req.params.peerId,
              text: req.body.text,
            },
          },
          {
            upsert: true,
            new: true,
            runValidators: true,
            setDefaultsOnInsert: true,
          },
        );
      } catch (error) {
        if (error.code !== 11000) throw error;
        message = await CoachMessage.findOne(filter);
      }
      if (
        !message ||
        message.recipientId !== req.params.peerId ||
        message.text !== req.body.text
      )
        return res
          .status(409)
          .json({ error: "Este envío ya corresponde a otro mensaje" });
      res.status(201).json({ message });
    } catch (error) {
      next(error);
    }
  },
);
router.patch(
  "/:peerId/read",
  [
    param("peerId").isMongoId(),
    body("messageIds").isArray({ min: 1, max: 100 }),
    body("messageIds.*").isMongoId(),
    validate,
  ],
  authorizeConversation,
  async (req, res, next) => {
    try {
      const result = await CoachMessage.updateMany(
        {
          ...req.messagePair,
          _id: { $in: req.body.messageIds },
          recipientId: req.user.id,
          readAt: null,
        },
        { $set: { readAt: new Date() } },
      );
      res.json({ updated: result.modifiedCount });
    } catch (error) {
      next(error);
    }
  },
);
export default router;
