const mongoose = require("mongoose");

const chapterSchema = new mongoose.Schema(
  {
    meeting: { type: mongoose.Schema.Types.ObjectId, ref: "Meeting", required: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true }, // e.g. "Chapter 3 — Java OOP"
    explanation: { type: String },
    notes: { type: String },
    codeExamples: [
      {
        language: String,
        code: String,
        description: String,
      },
    ],
    links: [
      {
        title: String,
        url: String,
      },
    ],
    videoUrl: String,
    pdfFile: String, // path to uploaded pdf
    images: [String], // paths to uploaded images
    isActive: { type: Boolean, default: false }, // currently displayed to participants
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Chapter", chapterSchema);