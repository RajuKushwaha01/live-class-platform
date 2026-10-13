const express = require("express");
const router = express.Router();
const Meeting = require("../models/Meeting");
const Chapter = require("../models/Chapter");
const Assignment = require("../models/Assignment");
const { isAuthenticated, authorizeRoles } = require("../middleware/auth");
const { buildLeaderboard } = require("../utils/leaderboard");
const { sendCSV } = require("../utils/csv");

router.use(isAuthenticated, authorizeRoles("host", "admin"));

async function studentRows(hostId) {
  const meetings = await Meeting.find({ host: hostId }).populate("participants", "name email");
  const board = await buildLeaderboard({ host: hostId });
  const bmap = {};
  board.forEach((b) => (bmap[b.id] = b));
  const map = {};
  meetings.forEach((m) =>
    m.participants.forEach((p) => {
      if (!p) return;
      const id = String(p._id);
      const r = map[id] || (map[id] = { id, name: p.name, email: p.email, classes: 0 });
      r.classes++;
    })
  );
  return Object.values(map)
    .map((r) => ({ ...r, tasks: bmap[r.id] ? bmap[r.id].tasks : 0, avg: bmap[r.id] ? bmap[r.id].avg : null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- DASHBOARD ----------
router.get("/dashboard", async (req, res) => {
  const hostId = req.session.user._id;
  const [meetings, assignments, board] = await Promise.all([
    Meeting.find({ host: hostId }).sort({ createdAt: -1 }),
    Assignment.find({ host: hostId }).select("title submissions"),
    buildLeaderboard({ host: hostId }),
  ]);

  const students = new Set();
  meetings.forEach((m) => m.participants.forEach((p) => students.add(String(p))));

  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i)); return d; });
  const activity = days.map(() => 0);
  const pendingList = [];
  const dist = [0, 0, 0, 0];
  let sum = 0, gradedN = 0;

  assignments.forEach((a) =>
    a.submissions.forEach((s) => {
      if (s.isGraded && s.maxScore) {
        const p = Math.round((s.totalScore / s.maxScore) * 100);
        sum += p; gradedN++;
        dist[p < 40 ? 0 : p < 60 ? 1 : p < 80 ? 2 : 3]++;
      } else {
        pendingList.push({ id: a._id, title: a.title, name: s.participantName, at: s.submittedAt });
      }
      const t = new Date(s.submittedAt); t.setHours(0, 0, 0, 0);
      const idx = days.findIndex((d) => d.getTime() === t.getTime());
      if (idx > -1) activity[idx]++;
    })
  );
  pendingList.sort((x, y) => new Date(y.at) - new Date(x.at));

  res.render("host/dashboard", {
    user: req.session.user,
    meetings: meetings.slice(0, 5),
    pendingList: pendingList.slice(0, 6),
    labels: days.map((d) => d.toLocaleDateString("en-US", { weekday: "short" })),
    activity,
    dist,
    top: board.slice(0, 5),
    stats: {
      meetings: meetings.length,
      live: meetings.filter((m) => m.status === "live").length,
      students: students.size,
      assignments: assignments.length,
      avgScore: gradedN ? Math.round(sum / gradedN) : 0,
      pending: pendingList.length,
    },
  });
});

// ---------- MEETINGS ----------
router.get("/meetings", async (req, res) => {
  const meetings = await Meeting.find({ host: req.session.user._id }).sort({ createdAt: -1 });
  res.render("host/meetings", { user: req.session.user, meetings });
});

// ---------- STUDENTS ----------
router.get("/students", async (req, res) => {
  const rows = await studentRows(req.session.user._id);
  res.render("host/students", { user: req.session.user, rows });
});

router.get("/students/export", async (req, res) => {
  const rows = await studentRows(req.session.user._id);
  sendCSV(res, "students.csv", [
    ["Name", "Email", "Classes joined", "Tasks graded", "Average %"],
    ...rows.map((r) => [r.name, r.email, r.classes, r.tasks, r.avg == null ? "" : r.avg]),
  ]);
});

// ---------- QUESTION BANK ----------
router.get("/questions", async (req, res) => {
  const sets = await Assignment.find({ host: req.session.user._id }).sort({ createdAt: -1 }).select("title questions");
  const bank = [];
  sets.forEach((a) =>
    a.questions.forEach((q) => bank.push({ text: q.questionText, type: q.type, points: q.points, set: a.title, setId: a._id }))
  );
  const counts = { mcq: 0, true_false: 0, short_answer: 0, coding: 0 };
  bank.forEach((b) => (counts[b.type] = (counts[b.type] || 0) + 1));
  res.render("host/questions", { user: req.session.user, bank, counts, sets: sets.length });
});

// ---------- ASSIGNMENTS ----------
router.get("/assignments", async (req, res) => {
  const assignments = await Assignment.find({ host: req.session.user._id }).sort({ createdAt: -1 });
  res.render("host/assignments", { user: req.session.user, assignments });
});

// ---------- MATERIALS ----------
router.get("/materials", async (req, res) => {
  const [chapters, meetings] = await Promise.all([
    Chapter.find({ host: req.session.user._id }).populate("meeting", "title meetingCode").sort({ createdAt: -1 }),
    Meeting.find({ host: req.session.user._id, status: { $ne: "ended" } }).sort({ createdAt: -1 }).select("title meetingCode"),
  ]);
  res.render("host/materials", { user: req.session.user, chapters, meetings });
});

module.exports = router;