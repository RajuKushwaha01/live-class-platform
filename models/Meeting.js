const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  questionText: { type: String, required: true },
  options: [String],
  correctOption: Number, // index of correct option (for MCQ)
  askedAt: { type: Date, default: Date.now },
  responses: [
    {
      participant: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      participantName: String,
      answer: String,
      isCorrect: Boolean,
      answeredAt: { type: Date, default: Date.now },
    },
  ],
});

const chatMessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  senderName: String,
  message: String,
  sentAt: { type: Date, default: Date.now },
});

const meetingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    chapterName: String,
    description: String,
    host: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    meetingCode: { type: String, unique: true, required: true },
    meetingPassword: { type: String, default: null },
    scheduledDate: Date,
    startTime: String,
    duration: Number, // in minutes
    maxParticipants: { type: Number, default: 50 },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    status: {
      type: String,
      enum: ["scheduled", "live", "ended"],
      default: "scheduled",
    },
    questions: [questionSchema],
    chatHistory: [chatMessageSchema],
    isRecording: { type: Boolean, default: false },
    recordingUrl: String,
    startedAt: Date,
    endedAt: Date,

    // Security & Room Access Control
    isLocked: { type: Boolean, default: false },
    waitingRoomEnabled: { type: Boolean, default: false },
    inviteOnly: { type: Boolean, default: false },
    invitedEmails: [{ type: String, lowercase: true, trim: true }],

    // Global Permissions
    participantPermissions: {
      chatAllowed: { type: Boolean, default: true },
      screenShareAllowed: { type: Boolean, default: true },
    },

    // Per-participant restrictions set by host during meeting
    restrictedParticipants: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        micDisabled: { type: Boolean, default: false },
        camDisabled: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Meeting", meetingSchema);