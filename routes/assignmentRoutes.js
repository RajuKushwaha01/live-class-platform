const express = require("express");
const router = express.Router();
const Assignment = require("../models/Assignment");
const Notification = require("../models/Notification");
const Meeting = require("../models/Meeting");
const { isAuthenticated, authorizeRoles } = require("../middleware/auth");
const { uploadAssignmentFile, uploadQuestionAssets } = require("../middleware/upload");

// GET Create Assignment Form
router.get("/create/:meetingCode?", isAuthenticated, authorizeRoles("host", "admin"), (req, res) => {
  res.render("host/create-assignment", {
    user: req.session.user,
    meetingCode: req.params.meetingCode || null,
    error: null,
  });
});

// POST Create Assignment — Handles type validation, image uploads & participant notifications
router.post("/create", isAuthenticated, authorizeRoles("host", "admin"), uploadQuestionAssets, async (req, res) => {
  try {
    const { title, type, description, dueDate, meetingId, questionsData } = req.body;
    let questions = JSON.parse(questionsData);

    // Map uploaded files onto their questions using field-name convention
    (req.files || []).forEach((file) => {
      const qImgMatch = file.fieldname.match(/^q(\d+)_image$/);
      const optImgMatch = file.fieldname.match(/^q(\d+)_option(\d+)_image$/);
      const filePath = `/uploads/questions/${file.filename}`;

      if (qImgMatch) {
        const qi = Number(qImgMatch[1]);
        if (questions[qi]) questions[qi].questionImage = filePath;
      } else if (optImgMatch) {
        const qi = Number(optImgMatch[1]);
        const oi = Number(optImgMatch[2]);
        if (questions[qi]) {
          questions[qi].optionImages = questions[qi].optionImages || [];
          questions[qi].optionImages[oi] = filePath;
        }
      }
    });

    // Type validation
    for (const q of questions) {
      if (q.type === "mcq" && (!q.options || q.options.filter(Boolean).length !== 4)) {
        throw new Error("Every MCQ question needs exactly 4 options.");
      }
      if (q.type === "true_false") q.options = ["True", "False"];
    }

    const assignment = await Assignment.create({
      meeting: meetingId || null,
      host: req.session.user._id,
      title,
      type,
      description,
      dueDate,
      questions,
      status: "published",
    });

    // 🔔 Notify participants
    let recipientIds = [];
    if (meetingId) {
      const m = await Meeting.findById(meetingId).select("participants");
      recipientIds = m ? m.participants : [];
    } else {
      const meetings = await Meeting.find({ host: req.session.user._id }).select("participants");
      const idSet = new Set();
      meetings.forEach((m) => m.participants.forEach((p) => idSet.add(String(p))));
      recipientIds = [...idSet];
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
    res.render("host/create-assignment", {
      user: req.session.user,
      meetingCode: null,
      error: err.message || "Failed to create assignment.",
    });
  }
});

// Participant: List assignments
router.get("/my-assignments", isAuthenticated, authorizeRoles("participant", "admin"), async (req, res) => {
  const assignments = await Assignment.find({ status: "published" }).sort({ createdAt: -1 });

  // Attach whether current user already submitted
  const withStatus = assignments.map((a) => {
    const submitted = a.submissions.some((s) => String(s.participant) === String(req.session.user._id));
    return { ...a.toObject(), alreadySubmitted: submitted };
  });

  res.render("participant/assignment-list", { user: req.session.user, assignments: withStatus });
});

// Participant: Take assignment page
router.get("/take/:id", isAuthenticated, authorizeRoles("participant", "admin"), async (req, res) => {
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) return res.status(404).send("Assignment not found");

  const mySubmission = assignment.submissions.find(
    (s) => String(s.participant) === String(req.session.user._id)
  );

  res.render("participant/take-assignment", {
    user: req.session.user,
    assignment,
    alreadySubmitted: !!mySubmission,
    mySubmission: mySubmission || null,
  });
});

// Participant: Submit assignment (auto-scoring)
router.post(
  "/submit/:id",
  isAuthenticated,
  authorizeRoles("participant", "admin"),
  uploadAssignmentFile.single("fileUpload"),
  async (req, res) => {
    try {
      const assignment = await Assignment.findById(req.params.id);
      if (!assignment) return res.status(404).send("Assignment not found");

      // Prevent duplicate submission
      const already = assignment.submissions.find(
        (s) => String(s.participant) === String(req.session.user._id)
      );
      if (already) return res.redirect(`/assignment/take/${req.params.id}`);

      const answers = JSON.parse(req.body.answers); // [{questionIndex, answerText}]
      let totalScore = 0;
      let maxScore = 0;

      const gradedAnswers = answers.map((ans) => {
        const question = assignment.questions[ans.questionIndex];
        maxScore += question.points;

        let isCorrect = false;
        let pointsAwarded = 0;

        // Auto-grade MCQ / True-False / Short Answer (exact match, case-insensitive)
        if (["mcq", "true_false", "short_answer"].includes(question.type) && question.correctAnswer) {
          isCorrect =
            ans.answerText.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase();
          pointsAwarded = isCorrect ? question.points : 0;
        }

        totalScore += pointsAwarded;

        return {
          questionIndex: ans.questionIndex,
          answerText: ans.answerText,
          isCorrect,
          pointsAwarded,
        };
      });

      // Determine if manual review is needed (coding questions can't be auto-graded)
      const hasCodingQuestion = assignment.questions.some((q) => q.type === "coding");

      assignment.submissions.push({
        participant: req.session.user._id,
        participantName: req.session.user.name,
        answers: gradedAnswers,
        totalScore,
        maxScore,
        isGraded: !hasCodingQuestion, // auto-graded assignments are "graded" immediately
        gradedAt: !hasCodingQuestion ? new Date() : null,
        fileUpload: req.file ? `/uploads/assignments/${req.file.filename}` : null,
      });

      await assignment.save();

      // 🔔 Notify + live-push to host in real time
      await Notification.create({
        recipient: assignment.host,
        type: "assignment",
        title: "New Submission Received",
        message: `${req.session.user.name} submitted "${assignment.title}" — ${totalScore}/${maxScore}`,
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

      res.render("participant/take-assignment", {
        user: req.session.user,
        assignment,
        alreadySubmitted: true,
        resultScore: totalScore,
        resultMax: maxScore,
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Submission failed.");
    }
  }
);

// Host: View results + Chart.js data
router.get("/results/:id", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const assignment = await Assignment.findById(req.params.id).populate("submissions.participant", "name email");
  if (!assignment) return res.status(404).send("Assignment not found");

  const scores = assignment.submissions.map((s) => s.totalScore);
  const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 0;

  res.render("host/assignment-results", { user: req.session.user, assignment, avgScore });
});

// Host: Manual grading screen
router.get("/grade/:id", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const assignment = await Assignment.findById(req.params.id).populate(
    "submissions.participant",
    "name email"
  );
  if (!assignment) return res.status(404).send("Assignment not found");
  res.render("host/grade-assignment", { user: req.session.user, assignment });
});

// Host: Save manual grade for one submission's answer(s)
router.post("/grade/:assignmentId/:submissionId", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  try {
    const { assignmentId, submissionId } = req.params;
    const assignment = await Assignment.findById(assignmentId);
    if (!assignment) return res.status(404).send("Assignment not found");

    const submission = assignment.submissions.id(submissionId);
    if (!submission) return res.status(404).send("Submission not found");

    const points = JSON.parse(req.body.pointsData);
    let newTotal = 0;

    points.forEach((p) => {
      const answer = submission.answers.find((a) => a.questionIndex === p.questionIndex);
      if (answer) {
        answer.pointsAwarded = Number(p.pointsAwarded) || 0;
        answer.isCorrect = answer.pointsAwarded > 0;
      }
    });

    submission.answers.forEach((a) => (newTotal += a.pointsAwarded));
    submission.totalScore = newTotal;

    submission.isGraded = true;
    submission.gradedAt = new Date();

    await assignment.save();

    // 🔔 Notify the student their assignment was graded
    await Notification.create({
      recipient: submission.participant,
      type: "assignment",
      title: "Assignment Graded",
      message: `Your submission for "${assignment.title}" scored ${newTotal}/${submission.maxScore}`,
      link: `/assignment/take/${assignment._id}`,
    });

    const io = req.app.get("io");
    if (io) {
      io.to(`user-${submission.participant}`).emit("new-notification", {
        title: "Assignment Graded",
        message: `"${assignment.title}" scored ${newTotal}/${submission.maxScore}`,
        link: `/assignment/take/${assignment._id}`,
      });
    }

    res.redirect(`/assignment/grade/${assignmentId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Grading failed.");
  }
});

module.exports = router;