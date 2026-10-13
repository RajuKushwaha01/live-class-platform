const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../models/User");
const Meeting = require("../models/Meeting");
const Assignment = require("../models/Assignment");
const { isAuthenticated, authorizeRoles } = require("../middleware/auth");
const { sendCSV } = require("../utils/csv");

router.use(isAuthenticated, authorizeRoles("admin"));

const isSelf = (req) => String(req.params.id) === String(req.session.user._id);

// ---------- DASHBOARD ----------
router.get("/dashboard", async (req, res) => {
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i)); return d; });
  const next = (d) => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; };

  const regs = await Promise.all(days.map((d) => User.countDocuments({ createdAt: { $gte: d, $lt: next(d) } })));
  const mtgs = await Promise.all(days.map((d) => Meeting.countDocuments({ createdAt: { $gte: d, $lt: next(d) } })));
  const [users, hosts, students, admins, blocked, live, meetings, assignments] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: "host" }),
    User.countDocuments({ role: "participant" }),
    User.countDocuments({ role: "admin" }),
    User.countDocuments({ isBlocked: true }),
    Meeting.countDocuments({ status: "live" }),
    Meeting.countDocuments(),
    Assignment.countDocuments(),
  ]);

  const recentUsers = await User.find().sort({ createdAt: -1 }).limit(6).select("name email role createdAt isBlocked");
  const recentMeetings = await Meeting.find().populate("host", "name").sort({ createdAt: -1 }).limit(6);
  const liveMeetings = await Meeting.find({ status: "live" }).populate("host", "name").limit(5);
  const io = req.app.get("io");

  res.render("admin/dashboard", {
    user: req.session.user,
    stats: { users, hosts, students, admins, blocked, live, meetings, assignments },
    labels: days.map((d) => d.toLocaleDateString("en-US", { weekday: "short" })),
    regs, mtgs, recentUsers, recentMeetings, liveMeetings,
    health: {
      uptime: process.uptime(),
      memMB: Math.round(process.memoryUsage().rss / 1048576),
      db: mongoose.connection.readyState === 1,
      sockets: io ? io.engine.clientsCount : 0,
    },
  });
});

// ---------- USERS ----------
router.get("/users", async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  res.render("admin/users", { user: req.session.user, users, msg: req.query.msg || null, err: req.query.err || null });
});


router.get("/users/export", async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  sendCSV(res, "users.csv", [
    ["Name", "Email", "Role", "Status", "Joined"],
    ...users.map((u) => [u.name, u.email, u.role, u.isBlocked ? "Blocked" : "Active", new Date(u.createdAt).toISOString()]),
  ]);
});

router.post("/users/:id/toggle-block", async (req, res) => {
  if (!isSelf(req)) {
    const u = await User.findById(req.params.id);
    if (u) { u.isBlocked = !u.isBlocked; await u.save(); }
  }
  res.redirect("/admin/users");
});

router.post("/users/:id/role", async (req, res) => {
  const allowed = ["participant", "host", "admin"];
  if (!isSelf(req) && allowed.includes(req.body.role)) {
    await User.findByIdAndUpdate(req.params.id, { role: req.body.role });
  }
  res.redirect("/admin/users");
});

router.post("/users/:id/delete", async (req, res) => {
  if (!isSelf(req)) await User.findByIdAndDelete(req.params.id);
  res.redirect("/admin/users");
});

// ---------- MEETINGS ----------
router.get("/meetings", async (req, res) => {
  const meetings = await Meeting.find().populate("host", "name email").sort({ createdAt: -1 });
  res.render("admin/meetings", { user: req.session.user, meetings });
});

router.get("/meetings/export", async (req, res) => {
  const meetings = await Meeting.find().populate("host", "name").sort({ createdAt: -1 });
  sendCSV(res, "meetings.csv", [
    ["Title", "Code", "Host", "Status", "Participants", "Started", "Ended"],
    ...meetings.map((m) => [
      m.title, m.meetingCode, m.host ? m.host.name : "", m.status, m.participants.length,
      m.startedAt ? new Date(m.startedAt).toISOString() : "", m.endedAt ? new Date(m.endedAt).toISOString() : "",
    ]),
  ]);
});

router.post("/meetings/:code/end", async (req, res) => {
  const m = await Meeting.findOneAndUpdate(
    { meetingCode: req.params.code, status: "live" },
    { status: "ended", endedAt: new Date() }
  );
  const io = req.app.get("io");
  if (m && io) io.to(m.meetingCode).emit("meeting-ended-by-host");
  res.redirect(req.get("referer") || "/admin/meetings");
});

// ---------- LIVE MONITOR ----------
router.get("/live-monitor", async (req, res) => {
  const liveMeetings = await Meeting.find({ status: "live" }).populate("host", "name email").sort({ startedAt: -1 });
  res.render("admin/live-monitor", { user: req.session.user, liveMeetings });
});

router.post("/users/create", async (req, res) => {
  const back = (k, v) => res.redirect("/admin/users?" + k + "=" + encodeURIComponent(v));
  try {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    const role = ["participant", "host", "admin"].includes(req.body.role) ? req.body.role : "participant";

    if (!name || !email || password.length < 6) return back("err", "Fill every field. Password needs at least 6 characters.");
    if (await User.findOne({ email })) return back("err", "That email is already registered.");

    await User.create({ name, email, password, role });
    back("msg", `Created ${role === "participant" ? "student" : role === "host" ? "teacher" : "admin"} account for ${email}`);
  } catch (e) {
    console.error(e);
    back("err", "Could not create the user.");
  }
});

module.exports = router;