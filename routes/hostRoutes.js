const express = require("express");
const router = express.Router();
const Meeting = require("../models/Meeting");
const User = require("../models/User");
const Chapter = require("../models/Chapter");
const Assignment = require("../models/Assignment");
const { isAuthenticated, authorizeRoles } = require("../middleware/auth");

router.get("/dashboard", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const meetings = await Meeting.find({ host: req.session.user._id }).sort({ createdAt: -1 });
  res.render("host/dashboard", { user: req.session.user, meetings });
});

// MEETINGS — full list with status filters
router.get("/meetings", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const meetings = await Meeting.find({ host: req.session.user._id }).sort({ createdAt: -1 });
  res.render("host/meetings", { user: req.session.user, meetings });
});

// STUDENTS — everyone who has ever joined this host's meetings
router.get("/students", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const meetings = await Meeting.find({ host: req.session.user._id }).populate(
    "participants",
    "name email profileImage"
  );

  const studentMap = {};
  meetings.forEach((m) => {
    m.participants.forEach((p) => {
      if (!studentMap[p._id]) {
        studentMap[p._id] = { ...p.toObject(), meetingsJoined: 0 };
      }
      studentMap[p._id].meetingsJoined += 1;
    });
  });

  const students = Object.values(studentMap);
  res.render("host/students", { user: req.session.user, students });
});

// MATERIALS — all chapters this host has published, across all meetings
router.get("/materials", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const chapters = await Chapter.find({ host: req.session.user._id })
    .populate("meeting", "title meetingCode")
    .sort({ createdAt: -1 });
  res.render("host/materials", { user: req.session.user, chapters, role: "host" });
});

// QUESTIONS — fetch quiz and chapter test sets
router.get("/questions", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const liveSets = await Assignment.find({ host: req.session.user._id, type: { $in: ["quiz", "chapter_test"] } }).sort({ createdAt: -1 });
  res.render("host/questions", { user: req.session.user, liveSets, role: "host" });
});

// ASSIGNMENTS — fetch host assignments
router.get("/assignments", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const assignments = await Assignment.find({ host: req.session.user._id }).sort({ createdAt: -1 });
  res.render("host/assignments", { user: req.session.user, assignments, role: "host" });
});

// SETTINGS — profile update
router.get("/settings", isAuthenticated, authorizeRoles("host", "admin"), (req, res) => {
  res.render("host/settings", { user: req.session.user, message: null, error: null });
});

router.post("/settings", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  try {
    const { name, email } = req.body;
    const updated = await User.findByIdAndUpdate(
      req.session.user._id,
      { name, email },
      { new: true }
    );
    req.session.user.name = updated.name;
    req.session.user.email = updated.email;
    res.render("host/settings", { user: req.session.user, message: "Profile updated successfully.", error: null });
  } catch (err) {
    res.render("host/settings", { user: req.session.user, message: null, error: "Update failed." });
  }
});

module.exports = router;