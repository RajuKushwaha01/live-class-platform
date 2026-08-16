const Meeting = require("../models/Meeting");
const Attendance = require("../models/Attendance");

const roomUsers = {}; // { meetingCode: { socketId: {...} } }
const waitingUsers = {}; // { meetingCode: { socketId: {...} } }
const attendanceLog = {}; // { socketId: attendanceRecordId }

function initMeetingSocket(io) {
  io.on("connection", (socket) => {
    console.log("🔌 Socket connected:", socket.id);

    // ---------- GLOBAL USER REGISTRATION (FOR PUSH NOTIFICATIONS & SUBMISSIONS) ----------
    socket.on("register-user", ({ userId }) => {
      if (userId) {
        socket.join(`user-${userId}`);
      }
    });

    // ---------- JOIN ROOM (checks waiting room) ----------
    socket.on("join-room", async ({ meetingCode, userId, name, role, isHost }) => {
      const meeting = await Meeting.findOne({ meetingCode });
      if (!meeting) return;

      socket.meetingCode = meetingCode;
      socket.userId = userId;
      socket.userName = name;
      socket.userRole = role;

      // If waiting room is enabled and user is not host → hold in waiting area
      if (meeting.waitingRoomEnabled && !isHost) {
        if (!waitingUsers[meetingCode]) waitingUsers[meetingCode] = {};
        waitingUsers[meetingCode][socket.id] = { userId, name, role };
        socket.join(`waiting-${meetingCode}`);

        // Notify host of new waiting participant
        io.to(meetingCode).emit("waiting-room-update", Object.values(waitingUsers[meetingCode]));
        socket.emit("waiting-for-approval");
        return;
      }

      await admitUserToRoom(io, socket, meetingCode, userId, name, role);
    });

    // ---------- HOST: ADMIT / DENY FROM WAITING ROOM ----------
    socket.on("admit-participant", async ({ meetingCode, targetSocketId }) => {
      const waitingUser = waitingUsers[meetingCode]?.[targetSocketId];
      if (!waitingUser) return;

      delete waitingUsers[meetingCode][targetSocketId];
      io.to(meetingCode).emit("waiting-room-update", Object.values(waitingUsers[meetingCode] || {}));

      io.to(targetSocketId).emit("admitted");
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        await admitUserToRoom(io, targetSocket, meetingCode, waitingUser.userId, waitingUser.name, waitingUser.role);
      }
    });

    socket.on("deny-participant", ({ meetingCode, targetSocketId }) => {
      if (waitingUsers[meetingCode]?.[targetSocketId]) {
        delete waitingUsers[meetingCode][targetSocketId];
        io.to(meetingCode).emit("waiting-room-update", Object.values(waitingUsers[meetingCode] || {}));
      }
      io.to(targetSocketId).emit("denied");
    });

    // ---------- WEBRTC SIGNALING ----------
    socket.on("webrtc-offer", ({ to, offer }) => {
      io.to(to).emit("webrtc-offer", { from: socket.id, offer, name: socket.userName });
    });

    socket.on("webrtc-answer", ({ to, answer }) => {
      io.to(to).emit("webrtc-answer", { from: socket.id, answer });
    });

    socket.on("webrtc-ice-candidate", ({ to, candidate }) => {
      io.to(to).emit("webrtc-ice-candidate", { from: socket.id, candidate });
    });

    // ---------- CHAT (respects chatAllowed permission) ----------
    socket.on("chat-message", async ({ meetingCode, message, name, userId }) => {
      const meeting = await Meeting.findOne({ meetingCode });
      if (meeting && !meeting.participantPermissions.chatAllowed && socket.userRole !== "host") {
        socket.emit("chat-blocked", { message: "Chat has been disabled by the host." });
        return;
      }

      io.to(meetingCode).emit("chat-message", {
        system: false,
        senderId: userId,
        senderName: name,
        message,
        time: new Date().toLocaleTimeString(),
      });

      try {
        await Meeting.findOneAndUpdate(
          { meetingCode },
          { $push: { chatHistory: { sender: userId, senderName: name, message } } }
        );
      } catch (e) {
        console.error("Chat save error:", e.message);
      }
    });

    // ---------- TYPING INDICATOR ----------
    socket.on("typing", ({ meetingCode, name }) => {
      socket.to(meetingCode).emit("user-typing", { name });
    });

    socket.on("stop-typing", ({ meetingCode, name }) => {
      socket.to(meetingCode).emit("user-stop-typing", { name });
    });

    // ---------- RAISE HAND (tracked for attendance) ----------
    socket.on("raise-hand", async ({ meetingCode, name, raised }) => {
      if (roomUsers[meetingCode]?.[socket.id]) {
        roomUsers[meetingCode][socket.id].handRaised = raised;
      }
      io.to(meetingCode).emit("hand-raised", { socketId: socket.id, name, raised });

      if (raised && attendanceLog[socket.id]) {
        await Attendance.findByIdAndUpdate(attendanceLog[socket.id], { $inc: { handRaisedCount: 1 } });
      }
    });

    // ---------- REACTIONS ----------
    socket.on("send-reaction", ({ meetingCode, name, emoji }) => {
      io.to(meetingCode).emit("reaction-received", { name, emoji, socketId: socket.id });
    });

    // ---------- MIC/CAM TOGGLE ----------
    socket.on("toggle-media", ({ meetingCode, type, enabled, name }) => {
      socket.to(meetingCode).emit("peer-media-toggle", { socketId: socket.id, type, enabled, name });
    });

    // ---------- GRANULAR HOST CONTROLS ----------
    socket.on("host-mute-participant", ({ meetingCode, targetSocketId }) => {
      io.to(targetSocketId).emit("force-mute");
    });

    socket.on("host-disable-camera", ({ meetingCode, targetSocketId }) => {
      io.to(targetSocketId).emit("force-camera-off");
    });

    socket.on("host-remove-participant", ({ meetingCode, targetSocketId }) => {
      io.to(targetSocketId).emit("force-remove");
      io.sockets.sockets.get(targetSocketId)?.leave(meetingCode);
    });

    // Toggle global chat / screenshare permissions
    socket.on("host-toggle-chat", async ({ meetingCode, allowed }) => {
      await Meeting.findOneAndUpdate({ meetingCode }, { "participantPermissions.chatAllowed": allowed });
      io.to(meetingCode).emit("chat-permission-changed", { allowed });
    });

    socket.on("host-toggle-screenshare", async ({ meetingCode, allowed }) => {
      await Meeting.findOneAndUpdate({ meetingCode }, { "participantPermissions.screenShareAllowed": allowed });
      io.to(meetingCode).emit("screenshare-permission-changed", { allowed });
    });

    // Lock / unlock meeting live toggle
    socket.on("host-toggle-lock", async ({ meetingCode, isLocked }) => {
      await Meeting.findOneAndUpdate({ meetingCode }, { isLocked });
      io.to(meetingCode).emit("meeting-lock-changed", { isLocked });
    });

    // ---------- SCREEN SHARE (respects permission) ----------
    socket.on("screen-share-start", async ({ meetingCode, name }) => {
      const meeting = await Meeting.findOne({ meetingCode });
      if (meeting && !meeting.participantPermissions.screenShareAllowed && socket.userRole !== "host") {
        socket.emit("screenshare-blocked");
        return;
      }
      socket.to(meetingCode).emit("screen-share-start", { socketId: socket.id, name });
    });

    socket.on("screen-share-stop", ({ meetingCode }) => {
      socket.to(meetingCode).emit("screen-share-stop", { socketId: socket.id });
    });

    // ---------- QUESTIONS / POLLS ----------
    socket.on("host-send-question", async ({ meetingCode, questionText, options }) => {
      const meeting = await Meeting.findOne({ meetingCode });
      if (meeting) {
        meeting.questions.push({ questionText, options });
        await meeting.save();
        const newQuestion = meeting.questions[meeting.questions.length - 1];
        io.to(meetingCode).emit("new-question", { questionId: newQuestion._id, questionText, options });
      }
    });

    socket.on("participant-answer", async ({ meetingCode, questionId, answer, userId, name }) => {
      const meeting = await Meeting.findOne({ meetingCode });
      if (meeting) {
        const question = meeting.questions.id(questionId);
        if (question) {
          question.responses.push({ participant: userId, participantName: name, answer });
          await meeting.save();
          io.to(meetingCode).emit("question-results-update", { questionId, responses: question.responses });

          if (attendanceLog[socket.id]) {
            await Attendance.findByIdAndUpdate(attendanceLog[socket.id], { $inc: { questionsAnswered: 1 } });
          }
        }
      }
    });

    // ---------- WHITEBOARD ----------
    socket.on("whiteboard-draw", ({ meetingCode, drawData }) => {
      socket.to(meetingCode).emit("whiteboard-draw", drawData);
    });

    socket.on("whiteboard-clear", ({ meetingCode }) => {
      socket.to(meetingCode).emit("whiteboard-clear");
    });

    // ---------- RECORDING ----------
    socket.on("recording-status", ({ meetingCode, isRecording }) => {
      io.to(meetingCode).emit("recording-status", { isRecording });
    });

    // ---------- ANNOUNCEMENTS ----------
    socket.on("host-announcement", ({ meetingCode, message }) => {
      io.to(meetingCode).emit("announcement", { message, time: new Date().toLocaleTimeString() });
    });

    // ---------- END MEETING FOR EVERYONE ----------
    socket.on("host-end-meeting", ({ meetingCode }) => {
      io.to(meetingCode).emit("meeting-ended-by-host");
    });

    // ---------- LEAVE / DISCONNECT ----------
    socket.on("leave-room", () => handleDisconnect(socket, io));
    socket.on("disconnect", () => handleDisconnect(socket, io));
  });
}

// Helper: admit a user into the live room + start attendance tracking
async function admitUserToRoom(io, socket, meetingCode, userId, name, role) {
  socket.join(meetingCode);
  socket.join(`user-${userId}`); // enables targeted notification push

  if (!roomUsers[meetingCode]) roomUsers[meetingCode] = {};
  roomUsers[meetingCode][socket.id] = { userId, name, role, handRaised: false };

  socket.to(meetingCode).emit("user-joined", { socketId: socket.id, userId, name, role });
  io.to(meetingCode).emit("participants-update", roomUsers[meetingCode]);

  io.to(meetingCode).emit("chat-message", {
    system: true,
    message: `${name} joined the meeting`,
    time: new Date().toLocaleTimeString(),
  });

  // Start attendance record
  try {
    const meeting = await Meeting.findOne({ meetingCode });
    if (meeting) {
      const record = await Attendance.create({
        meeting: meeting._id,
        participant: userId,
        participantName: name,
      });
      attendanceLog[socket.id] = record._id;
    }
  } catch (e) {
    console.error("Attendance start error:", e.message);
  }
}

async function handleDisconnect(socket, io) {
  const { meetingCode, userName } = socket;
  if (!meetingCode) return;

  if (roomUsers[meetingCode]) {
    delete roomUsers[meetingCode][socket.id];
    io.to(meetingCode).emit("participants-update", roomUsers[meetingCode]);
  }
  if (waitingUsers[meetingCode]) {
    delete waitingUsers[meetingCode][socket.id];
    io.to(meetingCode).emit("waiting-room-update", Object.values(waitingUsers[meetingCode] || {}));
  }

  socket.to(meetingCode).emit("user-left", { socketId: socket.id });
  io.to(meetingCode).emit("chat-message", {
    system: true,
    message: `${userName || "A participant"} left the meeting`,
    time: new Date().toLocaleTimeString(),
  });

  // Close attendance record
  if (attendanceLog[socket.id]) {
    try {
      const record = await Attendance.findById(attendanceLog[socket.id]);
      if (record) {
        record.leftAt = new Date();
        record.durationMinutes = Math.round((record.leftAt - record.joinedAt) / 60000);
        await record.save();
      }
    } catch (e) {
      console.error("Attendance close error:", e.message);
    }
    delete attendanceLog[socket.id];
  }

  console.log("❌ Socket disconnected:", socket.id);
}

module.exports = initMeetingSocket;