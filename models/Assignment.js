const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  questionImage: String, // Path to question image attachment
  type: {
    type: String,
    enum: ["mcq", "true_false", "short_answer", "coding"],
    default: "mcq",
  },
  options: [String], // Used for mcq
  optionImages: [String], // Parallel array to options for option-level images
  correctAnswer: String, // For mcq/true_false/short_answer auto-check
  points: { type: Number, default: 1 },
  starterCode: String, // For coding questions
  codeLanguage: String, // Language specifying execution context (e.g., javascript, python, cpp)
});

const submissionAnswerSchema = new mongoose.Schema({
  questionIndex: Number,
  answerText: String,
  isCorrect: Boolean,
  pointsAwarded: { type: Number, default: 0 },
});

const submissionSchema = new mongoose.Schema({
  participant: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  participantName: String,
  answers: [submissionAnswerSchema],
  totalScore: { type: Number, default: 0 },
  maxScore: { type: Number, default: 0 },
  isGraded: { type: Boolean, default: true }, // ⭐ NEW — false while awaiting manual review
  gradedAt: Date,                              // ⭐ NEW
  submittedAt: { type: Date, default: Date.now },
  fileUpload: String,
});

const assignmentSchema = new mongoose.Schema(
  {
    meeting: { type: mongoose.Schema.Types.ObjectId, ref: "Meeting" },
    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    type: {
      type: String,
      enum: ["homework", "quiz", "assignment", "chapter_test", "coding_challenge"],
      default: "quiz",
    },
    description: String,
    questions: [questionSchema],
    dueDate: Date,
    allowedParticipants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // Empty = all
    submissions: [submissionSchema],
    status: { type: String, enum: ["draft", "published", "closed"], default: "draft" },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Assignment", assignmentSchema);