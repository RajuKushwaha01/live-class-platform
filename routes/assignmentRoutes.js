const express = require("express");
const router = express.Router();
const Assignment = require("../models/Assignment");
const Meeting = require("../models/Meeting");
const Notification = require("../models/Notification");
const { isAuthenticated, authorizeRoles } = require("../middleware/auth");
const { uploadAssignmentFile, uploadQuestionAssets } = require("../middleware/upload");

const findMine = (assignment, userId) =>
  assignment.submissions.find((s) => String(s.participant) === String(userId));

// ---------- HOST: create form ----------
router.get("/create/:meetingCode?", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const meetings = await Meeting.find({ host: req.session.user._id }).sort({ createdAt: -1 }).select("title meetingCode");
  const pre = req.params.meetingCode ? meetings.find((m) => m.meetingCode === req.params.meetingCode) : null;
  res.render("host/create-assignment", {
    user: req.session.user,
    meetings,
    selectedId: pre ? String(pre._id) : "",
    error: null,
  });
});

// ---------- HOST: create ----------
router.post("/create", isAuthenticated, authorizeRoles("host", "admin"), uploadQuestionAssets, async (req, res) => {
  try {
    const { title, type, description, dueDate, meetingId, questionsData } = req.body;
    const questions = JSON.parse(questionsData);

    (req.files || []).forEach((file) => {
      const qImg = file.fieldname.match(/^q(\d+)_image$/);
      const oImg = file.fieldname.match(/^q(\d+)_option(\d+)_image$/);
      const filePath = `/uploads/questions/${file.filename}`;
      if (qImg && questions[Number(qImg[1])]) questions[Number(qImg[1])].questionImage = filePath;
      if (oImg && questions[Number(oImg[1])]) {
        const q = questions[Number(oImg[1])];
        q.optionImages = q.optionImages || [];
        q.optionImages[Number(oImg[2])] = filePath;
      }
    });

    for (const q of questions) {
      if (q.type === "mcq" && (!q.options || q.options.filter(Boolean).length !== 4))
        throw new Error("Every MCQ question needs exactly 4 options.");
      if (q.type === "true_false") q.options = ["True", "False"];
    }

    const assignment = await Assignment.create({
      meeting: meetingId || null,
      host: req.session.user._id,
      title, type, description,
      dueDate: dueDate || undefined,
      questions,
      status: "published",
    });

    // Who gets notified
    let recipientIds = [];
    if (meetingId) {
      const m = await Meeting.findById(meetingId).select("participants");
      recipientIds = m ? m.participants : [];
    } else {
      const meetings = await Meeting.find({ host: req.session.user._id }).select("participants");
      const set = new Set();
      meetings.forEach((m) => m.participants.forEach((p) => set.add(String(p))));
      recipientIds = [...set];
    }

    if (recipientIds.length) {
      await Notification.insertMany(
        recipientIds.map((uid) => ({
          recipient: uid,
          type: "assignment",
          title: "New Assignment Posted",
          message: `${req.session.user.name} posted "${title}"`,
          link: `/assignment/take/${assignment._id}`,
        }))
      );
      const io = req.app.get("io");
      if (io) {
        recipientIds.forEach((uid) =>
          io.to(`user-${uid}`).emit("new-notification", {
            title: "New Assignment Posted",
            message: `"${title}" was just posted`,
            link: `/assignment/take/${assignment._id}`,
          })
        );
      }
    }

    res.redirect(`/assignment/results/${assignment._id}`);
  } catch (err) {
    console.error(err);
    const meetings = await Meeting.find({ host: req.session.user._id }).select("title meetingCode");
    res.render("host/create-assignment", { user: req.session.user, meetings, selectedId: "", error: err.message || "Failed to create assignment." });
  }
});

// ---------- STUDENT: list ----------
router.get("/my-assignments", isAuthenticated, authorizeRoles("participant", "admin"), async (req, res) => {
  const list = await Assignment.find({ status: "published" }).sort({ createdAt: -1 });
  const assignments = list.map((a) => {
    const o = a.toObject();
    const mine = findMine(a, req.session.user._id);
    o.mine = mine ? { totalScore: mine.totalScore, maxScore: mine.maxScore, isGraded: mine.isGraded } : null;
    o.state = !mine ? "todo" : mine.isGraded ? "graded" : "review";
    o.overdue = !mine && !!a.dueDate && new Date(a.dueDate) < new Date();
    delete o.submissions;
    return o;
  });
  res.render("participant/assignment-list", { user: req.session.user, assignments });
});

// ---------- STUDENT: open task / see result ----------
router.get("/take/:id", isAuthenticated, authorizeRoles("participant", "admin"), async (req, res) => {
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) return res.status(404).send("Assignment not found");

  const mySubmission = findMine(assignment, req.session.user._id);
  res.render("participant/take-assignment", {
    user: req.session.user,
    assignment,
    alreadySubmitted: !!mySubmission,
    mySubmission: mySubmission || null,
  });
});

// ---------- STUDENT: submit ----------
router.post(
  "/submit/:id",
  isAuthenticated,
  authorizeRoles("participant", "admin"),
  uploadAssignmentFile.single("fileUpload"),
  async (req, res) => {
    try {
      const assignment = await Assignment.findById(req.params.id);
      if (!assignment) return res.status(404).send("Assignment not found");

      if (findMine(assignment, req.session.user._id)) {
        return res.redirect(`/assignment/take/${assignment._id}`);
      }

      let answers = [];
      try { answers = JSON.parse(req.body.answers || "[]"); } catch { answers = []; }
      const answerMap = {};
      answers.forEach((a) => { if (a) answerMap[a.questionIndex] = String(a.answerText ?? ""); });

      let totalScore = 0, maxScore = 0, needsManual = false;

      const gradedAnswers = assignment.questions.map((q, i) => {
        maxScore += q.points || 0;
        const text = answerMap[i] ?? "";
        const autoGradable = ["mcq", "true_false", "short_answer"].includes(q.type) && q.correctAnswer;

        let isCorrect = false, pointsAwarded = 0;
        if (autoGradable) {
          isCorrect = text.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase();
          pointsAwarded = isCorrect ? q.points : 0;
        } else {
          needsManual = true;
        }
        totalScore += pointsAwarded;
        return { questionIndex: i, answerText: text, isCorrect, pointsAwarded };
      });

      assignment.submissions.push({
        participant: req.session.user._id,
        participantName: req.session.user.name,
        answers: gradedAnswers,
        totalScore,
        maxScore,
        isGraded: !needsManual,
        gradedAt: needsManual ? null : new Date(),
        fileUpload: req.file ? `/uploads/assignments/${req.file.filename}` : null,
      });
      await assignment.save();

      await Notification.create({
        recipient: assignment.host,
        type: "assignment",
        title: "New Submission Received",
        message: `${req.session.user.name} submitted "${assignment.title}"${needsManual ? " — needs grading" : ` — ${totalScore}/${maxScore}`}`,
        link: `/assignment/grade/${assignment._id}`,
      });
      const io = req.app.get("io");
      if (io) {
        io.to(`user-${assignment.host}`).emit("new-submission", {
          assignmentId: assignment._id,
          assignmentTitle: assignment.title,
          participantName: req.session.user.name,
          score: totalScore,
          maxScore,
        });
      }

      return res.redirect(`/assignment/take/${assignment._id}`);
    } catch (err) {
      console.error(err);
      res.status(500).send("Submission failed.");
    }
  }
);

// ---------- HOST: results chart ----------
router.get("/results/:id", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const assignment = await Assignment.findById(req.params.id).populate("submissions.participant", "name email");
  if (!assignment) return res.status(404).send("Assignment not found");

  const scores = assignment.submissions.map((s) => s.totalScore);
  const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 0;
  res.render("host/assignment-results", { user: req.session.user, assignment, avgScore });
});

// ---------- HOST: grading screen ----------
router.get("/grade/:id", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const assignment = await Assignment.findById(req.params.id).populate("submissions.participant", "name email");
  if (!assignment) return res.status(404).send("Assignment not found");
  res.render("host/grade-assignment", { user: req.session.user, assignment });
});

// ---------- HOST: save marks ----------
router.post("/grade/:assignmentId/:submissionId", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.assignmentId);
    if (!assignment) return res.status(404).send("Assignment not found");
    const submission = assignment.submissions.id(req.params.submissionId);
    if (!submission) return res.status(404).send("Submission not found");

    const points = JSON.parse(req.body.pointsData || "[]");
    points.forEach((p) => {
      const ans = submission.answers.find((a) => a.questionIndex === p.questionIndex);
      if (ans) {
        const max = assignment.questions[p.questionIndex]?.points ?? 0;
        ans.pointsAwarded = Math.max(0, Math.min(Number(p.pointsAwarded) || 0, max));
        ans.isCorrect = ans.pointsAwarded > 0;
      }
    });

    submission.totalScore = submission.answers.reduce((sum, a) => sum + a.pointsAwarded, 0);
    submission.isGraded = true;
    submission.gradedAt = new Date();
    await assignment.save();

    await Notification.create({
      recipient: submission.participant,
      type: "assignment",
      title: "Assignment Graded",
      message: `"${assignment.title}" scored ${submission.totalScore}/${submission.maxScore}`,
      link: `/assignment/take/${assignment._id}`,
    });
    const io = req.app.get("io");
    if (io) {
      io.to(`user-${submission.participant}`).emit("new-notification", {
        title: "Assignment Graded",
        message: `Scored ${submission.totalScore}/${submission.maxScore}`,
        link: `/assignment/take/${assignment._id}`,
      });
    }

    res.redirect(`/assignment/grade/${assignment._id}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Grading failed.");
  }
});

module.exports = router;