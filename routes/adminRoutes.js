const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Meeting = require("../models/Meeting");
const { isAuthenticated, authorizeRoles } = require("../middleware/auth");

// Admin Dashboard
router.get("/dashboard", isAuthenticated, authorizeRoles("admin"), async (req, res) => {
  const totalUsers = await User.countDocuments();
  const totalHosts = await User.countDocuments({ role: "host" });
  const totalParticipants = await User.countDocuments({ role: "participant" });
  const activeMeetings = await Meeting.countDocuments({ status: "live" });
  const totalMeetings = await Meeting.countDocuments();

  res.render("admin/dashboard", {
    user: req.session.user,
    stats: { totalUsers, totalHosts, totalParticipants, activeMeetings, totalMeetings },
  });
});

// Manage Users
router.get("/users", isAuthenticated, authorizeRoles("admin"), async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  res.render("admin/users", { user: req.session.user, users });
});

// Block/Unblock User
router.post("/users/:id/toggle-block", isAuthenticated, authorizeRoles("admin"), async (req, res) => {
  const user = await User.findById(req.params.id);
  if (user) {
    user.isBlocked = !user.isBlocked;
    await user.save();
  }
  res.redirect("/admin/users");
});

// Delete User
router.post("/users/:id/delete", isAuthenticated, authorizeRoles("admin"), async (req, res) => {
  await User.findByIdAndDelete(req.params.id);
  res.redirect("/admin/users");
});

// View All Meetings
router.get("/meetings", isAuthenticated, authorizeRoles("admin"), async (req, res) => {
  const meetings = await Meeting.find().populate("host", "name email").sort({ createdAt: -1 });
  res.render("admin/dashboard", { user: req.session.user, meetings });
});

// Live Room Monitoring
router.get("/live-monitor", isAuthenticated, authorizeRoles("admin"), async (req, res) => {
  const liveMeetings = await Meeting.find({ status: "live" }).populate("host", "name email");
  res.render("admin/live-monitor", { user: req.session.user, liveMeetings });
});

module.exports = router;