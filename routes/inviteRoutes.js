const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const Meeting = require("../models/Meeting");
const Invitation = require("../models/Invitation");
const User = require("../models/User");
const Notification = require("../models/Notification");
const sendEmail = require("../utils/sendEmail");
const { isAuthenticated, authorizeRoles } = require("../middleware/auth");

// GET invite page
router.get("/:meetingCode", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const meeting = await Meeting.findOne({ meetingCode: req.params.meetingCode });
  if (!meeting) return res.status(404).send("Meeting not found");

  const invitations = await Invitation.find({ meeting: meeting._id }).sort({ sentAt: -1 });
  res.render("host/invite-participants", { user: req.session.user, meeting, invitations, message: null });
});

// POST send invite(s) — accepts comma-separated emails
router.post("/:meetingCode/send", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ meetingCode: req.params.meetingCode });
    if (!meeting) return res.status(404).send("Meeting not found");

    const { emails, inviteOnly } = req.body;
    const emailList = emails
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    meeting.inviteOnly = inviteOnly === "on";

    const link = `${process.env.CLIENT_URL}/meeting/${meeting.meetingCode}`;

    for (const email of emailList) {
      const token = crypto.randomBytes(16).toString("hex");

      await Invitation.create({
        meeting: meeting._id,
        invitedBy: req.session.user._id,
        email,
        inviteToken: token,
      });

      if (!meeting.invitedEmails.includes(email)) {
        meeting.invitedEmails.push(email);
      }

      // Send email
      await sendEmail({
        to: email,
        subject: `You're invited: ${meeting.title}`,
        html: `
          <h2>${meeting.title}</h2>
          <p>${req.session.user.name} invited you to join a live class: <b>${meeting.chapterName || ""}</b></p>
          <p><a href="${link}" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Join Meeting</a></p>
          <p>Meeting Code: <b>${meeting.meetingCode}</b></p>
        `,
      });

      // In-app notification if user already registered
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        await Notification.create({
          recipient: existingUser._id,
          type: "invite",
          title: "Meeting Invitation",
          message: `${req.session.user.name} invited you to "${meeting.title}"`,
          link: `/meeting/${meeting.meetingCode}`,
        });
      }
    }

    await meeting.save();

    const invitations = await Invitation.find({ meeting: meeting._id }).sort({ sentAt: -1 });
    res.render("host/invite-participants", {
      user: req.session.user,
      meeting,
      invitations,
      message: `✅ Sent ${emailList.length} invitation(s) successfully.`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to send invites.");
  }
});

// Toggle lock meeting
router.post("/:meetingCode/toggle-lock", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const meeting = await Meeting.findOne({ meetingCode: req.params.meetingCode });
  if (!meeting) return res.status(404).json({ error: "Meeting not found" });
  meeting.isLocked = !meeting.isLocked;
  await meeting.save();
  res.json({ success: true, isLocked: meeting.isLocked });
});

// Toggle waiting room
router.post("/:meetingCode/toggle-waiting-room", isAuthenticated, authorizeRoles("host", "admin"), async (req, res) => {
  const meeting = await Meeting.findOne({ meetingCode: req.params.meetingCode });
  if (!meeting) return res.status(404).json({ error: "Meeting not found" });
  meeting.waitingRoomEnabled = !meeting.waitingRoomEnabled;
  await meeting.save();
  res.json({ success: true, waitingRoomEnabled: meeting.waitingRoomEnabled });
});

module.exports = router;