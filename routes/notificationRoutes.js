const express = require("express");
const router = express.Router();
const Notification = require("../models/Notification");
const { isAuthenticated } = require("../middleware/auth");

// Get all notifications for logged-in user (API - used by bell dropdown)
router.get("/api/list", isAuthenticated, async (req, res) => {
  const notifications = await Notification.find({ recipient: req.session.user._id })
    .sort({ createdAt: -1 })
    .limit(20);
  const unreadCount = await Notification.countDocuments({
    recipient: req.session.user._id,
    isRead: false,
  });
  res.json({ notifications, unreadCount });
});

// Mark one as read
router.post("/:id/read", isAuthenticated, async (req, res) => {
  await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.session.user._id },
    { isRead: true }
  );
  res.json({ success: true });
});

// Mark all as read
router.post("/read-all", isAuthenticated, async (req, res) => {
  await Notification.updateMany({ recipient: req.session.user._id, isRead: false }, { isRead: true });
  res.json({ success: true });
});

module.exports = router;