const express = require("express");
const router = express.Router();
const Meeting = require("../models/Meeting");
const Chapter = require("../models/Chapter");
const User = require("../models/User");
const { isAuthenticated, authorizeRoles } = require("../middleware/auth");

router.get("/dashboard", isAuthenticated, authorizeRoles("participant", "admin"), async (req, res) => {
  const upcoming = await Meeting.find({ status: "scheduled", participants: req.session.user._id });
  res.render("participant/dashboard", { user: req.session.user, upcoming });
});

// MEETINGS — all meetings the participant has joined or is invited to
router.get("/meetings", isAuthenticated, authorizeRoles("participant", "admin"), async (req, res) => {
  const meetings = await Meeting.find({
    $or: [{ participants: req.session.user._id }, { invitedEmails: req.session.user.email }],
  })
    .populate("host", "name")
    .sort({ createdAt: -1 });
  res.render("participant/meetings", { user: req.session.user, meetings });
});

// MATERIALS — chapters from meetings this participant has joined
router.get("/materials", isAuthenticated, authorizeRoles("participant", "admin"), async (req, res) => {
  const meetings = await Meeting.find({ participants: req.session.user._id }).select("_id");
  const meetingIds = meetings.map((m) => m._id);
  const chapters = await Chapter.find({ meeting: { $in: meetingIds } }).populate("meeting", "title meetingCode").sort({ createdAt: -1 });
  res.render("participant/materials", { user: req.session.user, chapters, role: "participant" }); // ⭐ role added
});

// SETTINGS
router.get("/settings", isAuthenticated, authorizeRoles("participant", "admin"), (req, res) => {
  res.render("participant/settings", { user: req.session.user, message: null, error: null });
});

router.post("/settings", isAuthenticated, authorizeRoles("participant", "admin"), async (req, res) => {
  try {
    const { name, email } = req.body;
    const updated = await User.findByIdAndUpdate(
      req.session.user._id,
      { name, email },
      { new: true }
    );
    req.session.user.name = updated.name;
    req.session.user.email = updated.email;
    res.render("participant/settings", { user: req.session.user, message: "Profile updated.", error: null });
  } catch (err) {
    res.render("participant/settings", { user: req.session.user, message: null, error: "Update failed." });
  }
});

module.exports = router;