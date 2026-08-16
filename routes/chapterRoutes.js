const express = require("express");
const router = express.Router();
const Chapter = require("../models/Chapter");
const Meeting = require("../models/Meeting");
const { isAuthenticated, authorizeRoles } = require("../middleware/auth");
const { uploadChapterFiles } = require("../middleware/upload");

// GET Create Chapter Form
router.get("/create/:meetingCode", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const meeting = await Meeting.findOne({ meetingCode: req.params.meetingCode });
  if (!meeting) return res.status(404).send("Meeting not found");
  res.render("host/create-chapter", { user: req.session.user, meeting, error: null });
});

// POST Create Chapter (with file uploads)
router.post(
  "/create/:meetingCode",
  isAuthenticated,
  authorizeRoles("host", "admin"),
  uploadChapterFiles.fields([
    { name: "pdfFile", maxCount: 1 },
    { name: "images", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const meeting = await Meeting.findOne({ meetingCode: req.params.meetingCode });
      if (!meeting) return res.status(404).send("Meeting not found");

      const { title, explanation, notes, videoUrl } = req.body;

      // Parse code examples (sent as JSON string from frontend)
      let codeExamples = [];
      if (req.body.codeExamples) {
        try {
          codeExamples = JSON.parse(req.body.codeExamples);
        } catch (e) {
          codeExamples = [];
        }
      }

      // Parse links
      let links = [];
      if (req.body.links) {
        try {
          links = JSON.parse(req.body.links);
        } catch (e) {
          links = [];
        }
      }

      const chapter = await Chapter.create({
        meeting: meeting._id,
        host: req.session.user._id,
        title,
        explanation,
        notes,
        videoUrl,
        codeExamples,
        links,
        pdfFile: req.files.pdfFile ? `/uploads/chapters/${req.files.pdfFile[0].filename}` : null,
        images: req.files.images ? req.files.images.map((f) => `/uploads/chapters/${f.filename}`) : [],
      });

      res.redirect(`/meeting/room/${req.params.meetingCode}?chapterCreated=${chapter._id}`);
    } catch (err) {
      console.error(err);
      res.render("host/create-chapter", {
        user: req.session.user,
        meeting: { meetingCode: req.params.meetingCode },
        error: "Failed to create chapter.",
      });
    }
  }
);

// Get all chapters for a meeting (API - used by JS to load into panel)
router.get("/api/:meetingCode", isAuthenticated, async (req, res) => {
  const meeting = await Meeting.findOne({ meetingCode: req.params.meetingCode });
  if (!meeting) return res.status(404).json({ error: "Meeting not found" });
  const chapters = await Chapter.find({ meeting: meeting._id }).sort({ createdAt: -1 });
  res.json(chapters);
});

// Set active chapter (shown live to all participants)
router.post("/:id/activate", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const chapter = await Chapter.findById(req.params.id);
  if (!chapter) return res.status(404).json({ error: "Not found" });

  await Chapter.updateMany({ meeting: chapter.meeting }, { isActive: false });
  chapter.isActive = true;
  await chapter.save();

  res.json({ success: true, chapter });
});

module.exports = router;