const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    meeting: { type: mongoose.Schema.Types.ObjectId, ref: "Meeting", required: true },
    participant: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    participantName: String,
    joinedAt: { type: Date, default: Date.now },
    leftAt: Date,
    durationMinutes: { type: Number, default: 0 },
    questionsAnswered: { type: Number, default: 0 },
    handRaisedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Attendance", attendanceSchema);