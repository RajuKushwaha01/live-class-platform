const express = require("express");
const router = express.Router();
const Meeting = require("../models/Meeting");
const Chapter = require("../models/Chapter");
const Assignment = require("../models/Assignment");
const { isAuthenticated, authorizeRoles } = require("../middleware/auth");
const { buildLeaderboard } = require("../utils/leaderboard");

router.use(isAuthenticated, authorizeRoles("participant", "admin"));

// ---------- DASHBOARD ----------
router.get("/dashboard", async (req, res) => {
  const uid = String(req.session.user._id);
  const email = (req.session.user.email || "").toLowerCase();

  const meetings = await Meeting.find({
    status: { $in: ["scheduled", "live"] },
    $or: [{ participants: req.session.user._id }, { invitedEmails: email }, { inviteOnly: { $ne: true } }],
  })
    .populate("host", "name")
    .sort({ status: 1, createdAt: -1 })
    .limit(8);

  const all = await Assignment.find({ status: "published" }).sort({ createdAt: -1 }).select("title type dueDate questions submissions");

  const pending = [], results = [];
  let review = 0, done = 0;
  all.forEach((a) => {
    const mine = a.submissions.find((s) => String(s.participant) === uid);
    if (!mine) {
      pending.push({
        _id: a._id, title: a.title, type: a.type, dueDate: a.dueDate, count: a.questions.length,
        overdue: !!(a.dueDate && new Date(a.dueDate) < new Date()),
      });
    } else {
      done++;
      if (mine.isGraded && mine.maxScore) {
        results.push({
          _id: a._id, title: a.title, score: mine.totalScore, max: mine.maxScore,
          pct: Math.round((mine.totalScore / mine.maxScore) * 100), at: mine.gradedAt || mine.submittedAt,
        });
      } else review++;
    }
  });
  results.sort((a, b) => new Date(a.at) - new Date(b.at));

  const board = await buildLeaderboard();
  const idx = board.findIndex((b) => b.id === uid);
  const avg = results.length ? Math.round(results.reduce((s, r) => s + r.pct, 0) / results.length) : 0;
  const last = results.slice(-8);

  res.render("participant/dashboard", {
    user: req.session.user,
    meetings,
    pending: pending.slice(0, 5),
    recent: [...results].reverse().slice(0, 4),
    chart: { labels: last.map((r) => r.title.slice(0, 16)), data: last.map((r) => r.pct) },
    stats: {
      upcoming: meetings.length,
      pending: pending.length,
      review,
      done,
      avg,
      rank: idx > -1 ? idx + 1 : null,
      ranked: board.length,
      completion: all.length ? Math.round((done / all.length) * 100) : 0,
    },
  });
});

// ---------- CLASSES ----------
router.get("/meetings", async (req, res) => {
  const email = (req.session.user.email || "").toLowerCase();
  const meetings = await Meeting.find({
    $or: [
      { participants: req.session.user._id },
      { invitedEmails: email },
      { inviteOnly: { $ne: true }, status: { $in: ["scheduled", "live"] } },
    ],
  })
    .populate("host", "name")
    .sort({ createdAt: -1 });
  res.render("participant/meetings", { user: req.session.user, meetings });
});

// ---------- MATERIALS ----------
router.get("/materials", async (req, res) => {
  const email = (req.session.user.email || "").toLowerCase();
  const mine = await Meeting.find({
    $or: [{ participants: req.session.user._id }, { invitedEmails: email }],
  }).select("_id");
  const chapters = await Chapter.find({ meeting: { $in: mine.map((m) => m._id) } })
    .populate("meeting", "title meetingCode")
    .sort({ createdAt: -1 });
  res.render("participant/materials", { user: req.session.user, chapters });
});

// ---------- LEADERBOARD ----------
router.get("/leaderboard", async (req, res) => {
  const board = await buildLeaderboard();
  res.render("participant/leaderboard", { user: req.session.user, board, me: String(req.session.user._id) });
});

module.exports = router;