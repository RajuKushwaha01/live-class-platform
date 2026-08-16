const express = require("express");
const router = express.Router();
const { nanoid } = require("nanoid");
const bcrypt = require("bcrypt");
const Meeting = require("../models/Meeting");
const User = require("../models/User");
const Notification = require("../models/Notification");
const { isAuthenticated, authorizeRoles } = require("../middleware/auth");

// GET Create Meeting Page
router.get("/create", isAuthenticated, authorizeRoles("host", "admin"), (req, res) => {
  res.render("host/create-meeting", { user: req.session.user, error: null });
});

// POST Create Meeting
router.post("/create", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  try {
    const {
      title,
      chapterName,
      description,
      scheduledDate,
      startTime,
      duration,
      maxParticipants,
      meetingPassword,
      inviteOnly,
      invitedEmails,
      waitingRoomEnabled,
    } = req.body;

    const meetingCode = nanoid(8).toUpperCase();

    let hashedPassword = null;
    if (meetingPassword && meetingPassword.trim() !== "") {
      hashedPassword = await bcrypt.hash(meetingPassword, 10);
    }

    // Process comma/newline separated email list if present
    const emailList = invitedEmails
      ? invitedEmails
          .split(/[\n,]+/)
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e.length > 0)
      : [];

    const meeting = await Meeting.create({
      title,
      chapterName,
      description,
      host: req.session.user._id,
      meetingCode,
      meetingPassword: hashedPassword,
      scheduledDate,
      startTime,
      duration,
      maxParticipants: maxParticipants || 50,
      inviteOnly: inviteOnly === "true" || inviteOnly === true,
      invitedEmails: emailList,
      waitingRoomEnabled: waitingRoomEnabled === "true" || waitingRoomEnabled === true,
    });

    res.redirect(`/meeting/success/${meeting.meetingCode}`);
  } catch (err) {
    console.error(err);
    res.render("host/create-meeting", { user: req.session.user, error: "Failed to create meeting." });
  }
});

// Success Page — shows shareable link
router.get("/success/:code", isAuthenticated, async (req, res) => {
  const meeting = await Meeting.findOne({ meetingCode: req.params.code });
  if (!meeting) return res.status(404).send("Meeting not found");
  res.render("host/create-meeting", {
    user: req.session.user,
    error: null,
    createdMeeting: meeting,
  });
});

// GET Join Meeting Page (via link) — with invite-only, lock, and status checks
router.get("/:code", isAuthenticated, async (req, res) => {
  const meeting = await Meeting.findOne({ meetingCode: req.params.code.toUpperCase() }).populate(
    "host",
    "name email"
  );

  if (!meeting) {
    return res.status(404).render("error", { message: "Meeting not found. Check your link." });
  }

  // STATUS CHECK: Block access if the meeting has ended
  if (meeting.status === "ended") {
    return res.render("error", { message: "🚫 This meeting has already ended. Please contact your host for a new session." });
  }

  const isHost = String(meeting.host._id) === String(req.session.user._id);

  if (meeting.isLocked && !isHost) {
    return res.render("error", { message: "🔒 This meeting is locked by the host. Please contact them." });
  }

  if (meeting.inviteOnly && !isHost) {
    const isInvited = meeting.invitedEmails.includes(req.session.user.email.toLowerCase());
    if (!isInvited) {
      return res.render("error", { message: "This meeting is invite-only. You have not been invited." });
    }
  }

  res.render("meeting/join", { user: req.session.user, meeting, error: null });
});

// POST Join Meeting — routed through waiting room if enabled
router.post("/:code/join", isAuthenticated, async (req, res) => {
  const meeting = await Meeting.findOne({ meetingCode: req.params.code.toUpperCase() });
  if (!meeting) return res.status(404).send("Meeting not found");

  // STATUS CHECK: Block join submissions if the meeting has ended
  if (meeting.status === "ended") {
    return res.render("error", { message: "🚫 This meeting has already ended." });
  }

  const isHost = String(meeting.host) === String(req.session.user._id);

  if (meeting.meetingPassword) {
    const isMatch = await bcrypt.compare(req.body.password || "", meeting.meetingPassword);
    if (!isMatch) {
      return res.render("meeting/join", {
        user: req.session.user,
        meeting,
        error: "Incorrect meeting password.",
      });
    }
  }

  if (meeting.participants.length >= meeting.maxParticipants) {
    return res.render("meeting/join", { user: req.session.user, meeting, error: "Meeting is full." });
  }

  // Add participant if not already added
  if (!meeting.participants.includes(req.session.user._id)) {
    meeting.participants.push(req.session.user._id);
    await meeting.save();
  }

  // Track in user's history
  await User.findByIdAndUpdate(req.session.user._id, { $addToSet: { meetingsAttended: meeting._id } });

  // Route to waiting room if enabled (host always skips it)
  if (meeting.waitingRoomEnabled && !isHost) {
    return res.redirect(`/meeting/waiting/${meeting.meetingCode}`);
  }

  res.redirect(`/meeting/room/${meeting.meetingCode}`);
});

// GET Waiting Room page
router.get("/waiting/:code", isAuthenticated, async (req, res) => {
  const meeting = await Meeting.findOne({ meetingCode: req.params.code.toUpperCase() }).populate("host", "name");
  if (!meeting) return res.status(404).send("Meeting not found");

  if (meeting.status === "ended") {
    return res.render("error", { message: "🚫 This meeting has already ended." });
  }

  res.render("meeting/waiting-room", { user: req.session.user, meeting });
});

// GET Meeting Room (the live classroom itself)
router.get("/room/:code", isAuthenticated, async (req, res) => {
  const meeting = await Meeting.findOne({ meetingCode: req.params.code.toUpperCase() }).populate(
    "host",
    "name email"
  );

  if (!meeting) return res.status(404).render("error", { message: "Meeting not found." });

  // STATUS CHECK: Block entry to live room if meeting has ended
  if (meeting.status === "ended") {
    return res.render("error", { message: "🚫 This meeting has already ended." });
  }

  const isHost = String(meeting.host._id) === String(req.session.user._id);

  // ⭐ MEETING GOES LIVE — broadcast to every relevant registered participant
  if (isHost && meeting.status === "scheduled") {
    meeting.status = "live";
    meeting.startedAt = new Date();
    await meeting.save();

    // Decide who gets notified: invite-only → invited people; open meeting → all registered participants
    let recipients = [];
    if (meeting.inviteOnly) {
      const invitedUsers = await User.find({ email: { $in: meeting.invitedEmails } }).select("_id");
      recipients = invitedUsers.map((u) => u._id);
    } else {
      const allParticipants = await User.find({ role: "participant" }).select("_id");
      recipients = allParticipants.map((u) => u._id);
    }

    if (recipients.length) {
      // Persist notifications so they still show up later in the bell
      await Notification.insertMany(
        recipients.map((uid) => ({
          recipient: uid,
          type: "meeting_start",
          title: "🔴 Class is Live Now!",
          message: `${meeting.host.name} started "${meeting.title}" — join now.`,
          link: `/meeting/${meeting.meetingCode}`,
        }))
      );

      // ⭐ Real-time push — instant banner even if they never touch the bell
      const io = req.app.get("io");
      if (io) {
        recipients.forEach((uid) => {
          io.to(`user-${uid}`).emit("meeting-live", {
            meetingTitle: meeting.title,
            hostName: meeting.host.name,
            chapterName: meeting.chapterName,
            link: `/meeting/${meeting.meetingCode}`,
          });
        });
      }
    }
  }

  res.render("meeting/room", {
    user: req.session.user,
    meeting,
    isHost,
  });
});

// POST End Meeting (host only)
router.post("/:code/end", isAuthenticated, async (req, res) => {
  const meeting = await Meeting.findOne({ meetingCode: req.params.code.toUpperCase() });
  if (!meeting) return res.status(404).send("Meeting not found");

  if (String(meeting.host) !== String(req.session.user._id)) {
    return res.status(403).send("Only host can end the meeting.");
  }

  meeting.status = "ended";
  meeting.endedAt = new Date();
  await meeting.save();

  res.redirect("/host/dashboard");
});

module.exports = router;