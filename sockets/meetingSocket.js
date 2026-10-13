const Meeting = require("../models/Meeting");
const Attendance = require("../models/Attendance");
const Chapter = require("../models/Chapter");

const rooms = {};          // code -> { socketId: user }
const waiting = {};        // code -> { socketId: {userId,name} }
const admitted = {};       // code -> Set(userId)  (let through the waiting room)
const removed = {};        // code -> Set(userId)  (kicked by host)
const meta = {};           // code -> { hostId, chatAllowed, shareAllowed }
const attendanceLog = {};  // socketId -> attendance _id

const EMOJIS = ["👍", "❤️", "😂", "🎉", "😮", "👏", "🔥"];
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clip = (s, n) => String(s == null ? "" : s).trim().slice(0, n || 1000);
const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const listRoom = (c) => Object.values(rooms[c] || {});
const listWait = (c) => Object.entries(waiting[c] || {}).map(([socketId, u]) => ({ socketId, ...u }));
const cleanReply = (r) => {
  if (!r || typeof r !== "object") return null;
  const text = clip(r.text, 160);
  return text ? { id: clip(r.id, 40), name: clip(r.name, 60), text } : null;
};

function initMeetingSocket(io) {
  io.on("connection", (socket) => {
    // Identity comes from the login session — never from the browser's payload.
    const sess = socket.request.session;
    const me = sess && sess.user;
    if (!me) { socket.emit("auth-required"); return socket.disconnect(true); }

    socket.userId = String(me._id);
    socket.userName = me.name;
    socket.userRole = me.role;
    socket.join(`user-${socket.userId}`); // personal channel: notifications + private messages

    const inRoom = () => !!(socket.meetingCode && rooms[socket.meetingCode] && rooms[socket.meetingCode][socket.id]);
    const system = (code, text) => io.to(code).emit("system-message", { text, time: new Date().toISOString() });

    socket.on("register-user", () => {}); // kept for older pages; identity is now automatic

    // ================= JOIN =================
    socket.on("join-room", async ({ meetingCode } = {}) => {
      const code = clip(meetingCode, 20).toUpperCase();
      try {
        const meeting = await Meeting.findOne({ meetingCode: code });
        if (!meeting || meeting.status === "ended") return socket.emit("room-error", { message: "This class has ended or does not exist." });

        const isHost = String(meeting.host) === socket.userId;
        const mod = isHost || socket.userRole === "admin";
        if (!mod && removed[code] && removed[code].has(socket.userId)) return socket.emit("room-error", { message: "You were removed from this class by the host." });
        if (!mod && !meeting.participants.some((p) => String(p) === socket.userId)) return socket.emit("room-error", { message: "Please join this class from its link first." });

        socket.meetingCode = code;
        socket.isHost = isHost;
        socket.isMod = mod;
        const perms = meeting.participantPermissions || {};
        meta[code] = { hostId: String(meeting.host), chatAllowed: perms.chatAllowed !== false, shareAllowed: perms.screenShareAllowed !== false };
        if (mod) socket.join(`mods-${code}`);

        const passed = admitted[code] && admitted[code].has(socket.userId);
        if (meeting.waitingRoomEnabled && !mod && !passed) {
          waiting[code] = waiting[code] || {};
          waiting[code][socket.id] = { userId: socket.userId, name: socket.userName };
          socket.join(`waiting-${code}`);
          io.to(`mods-${code}`).emit("waiting-room-update", listWait(code));
          return socket.emit("waiting-for-approval");
        }
        await admit(socket, meeting);
      } catch (e) {
        console.error("join-room:", e.message);
        socket.emit("room-error", { message: "Could not join the class. Please refresh." });
      }
    });

    async function admit(sock, meeting) {
      const code = sock.meetingCode;
      sock.join(code);
      rooms[code] = rooms[code] || {};
      rooms[code][sock.id] = {
        socketId: sock.id, userId: sock.userId, name: sock.userName, role: sock.userRole,
        isHost: sock.isHost, handRaised: false, mic: true, cam: true,
      };
      const m = meta[code];
      sock.emit("room-joined", {
        selfSocketId: sock.id, hostUserId: m.hostId, chatAllowed: m.chatAllowed, shareAllowed: m.shareAllowed,
        history: (meeting.chatHistory || []).slice(-60).map((c) => ({
          id: String(c._id), scope: "public", text: c.message, time: c.sentAt,
          from: { userId: String(c.sender || ""), name: c.senderName, isHost: String(c.sender) === m.hostId },
        })),
      });
      sock.to(code).emit("user-joined", { socketId: sock.id, userId: sock.userId, name: sock.userName, isHost: sock.isHost });
      io.to(code).emit("participants-update", listRoom(code));
      system(code, `${sock.userName} joined`);
      try {
        const rec = await Attendance.create({ meeting: meeting._id, participant: sock.userId, participantName: sock.userName });
        attendanceLog[sock.id] = rec._id;
      } catch (e) { console.error("attendance:", e.message); }
    }

    // ================= WAITING ROOM (host) =================
    socket.on("admit-participant", ({ targetSocketId } = {}) => {
      const code = socket.meetingCode;
      if (!socket.isMod || !waiting[code] || !waiting[code][targetSocketId]) return;
      const u = waiting[code][targetSocketId];
      delete waiting[code][targetSocketId];
      (admitted[code] = admitted[code] || new Set()).add(u.userId);
      io.to(`mods-${code}`).emit("waiting-room-update", listWait(code));
      io.to(targetSocketId).emit("admitted");
    });

    socket.on("deny-participant", ({ targetSocketId } = {}) => {
      const code = socket.meetingCode;
      if (!socket.isMod || !waiting[code] || !waiting[code][targetSocketId]) return;
      delete waiting[code][targetSocketId];
      io.to(`mods-${code}`).emit("waiting-room-update", listWait(code));
      io.to(targetSocketId).emit("denied");
    });

    // ================= WEBRTC SIGNALING =================
    const relay = (evt, key) => socket.on(evt, (d = {}) => {
      if (!inRoom() || !rooms[socket.meetingCode][d.to]) return;
      io.to(d.to).emit(evt, { from: socket.id, [key]: d[key], name: socket.userName });
    });
    relay("webrtc-offer", "offer");
    relay("webrtc-answer", "answer");
    relay("webrtc-ice-candidate", "candidate");

    // ================= PUBLIC CHAT =================
    socket.on("chat-message", async ({ text, replyTo } = {}) => {
      if (!inRoom()) return;
      const code = socket.meetingCode;
      text = clip(text);
      if (!text) return;
      if (!socket.isMod && meta[code].chatAllowed === false)
        return socket.emit("chat-blocked", { message: "Public chat is turned off. You can still message the teacher privately." });

      io.to(code).emit("chat-message", {
        id: rid(), scope: "public", text, replyTo: cleanReply(replyTo), time: new Date().toISOString(),
        from: { userId: socket.userId, name: socket.userName, isHost: socket.isHost },
      });
      Meeting.updateOne({ meetingCode: code }, { $push: { chatHistory: { sender: socket.userId, senderName: socket.userName, message: text } } })
        .catch((e) => console.error("chat save:", e.message));
    });

    // ================= PRIVATE MESSAGES =================
    // Teacher ↔ anyone. Students can only message the teacher.
    const dmAllowed = (toUserId) => socket.isMod || toUserId === meta[socket.meetingCode].hostId;

    socket.on("private-message", ({ toUserId, text, replyTo } = {}) => {
      if (!inRoom()) return;
      const code = socket.meetingCode;
      toUserId = String(toUserId || "");
      text = clip(text);
      if (!text || !toUserId) return;
      if (!dmAllowed(toUserId)) return socket.emit("dm-failed", { message: "Students can only message the teacher privately." });
      const target = listRoom(code).find((u) => u.userId === toUserId);
      if (!target) return socket.emit("dm-failed", { message: "That person isn't in the class right now." });

      const msg = {
        id: rid(), scope: "dm", meetingCode: code, text, replyTo: cleanReply(replyTo), time: new Date().toISOString(),
        from: { userId: socket.userId, name: socket.userName, isHost: socket.isHost },
        to: { userId: target.userId, name: target.name },
      };
      io.to(`user-${socket.userId}`).emit("private-message", msg);
      if (target.userId !== socket.userId) io.to(`user-${target.userId}`).emit("private-message", msg);
    });

    socket.on("typing", ({ scope, toUserId } = {}) => {
      if (!inRoom()) return;
      const payload = { scope, userId: socket.userId, name: socket.userName };
      if (scope === "dm") {
        toUserId = String(toUserId || "");
        if (toUserId && dmAllowed(toUserId)) io.to(`user-${toUserId}`).emit("typing", payload);
      } else socket.to(socket.meetingCode).emit("typing", { ...payload, scope: "public" });
    });

    // ================= HAND / REACTIONS / MEDIA =================
    socket.on("raise-hand", ({ raised } = {}) => {
      if (!inRoom()) return;
      const code = socket.meetingCode;
      rooms[code][socket.id].handRaised = !!raised;
      io.to(code).emit("participants-update", listRoom(code));
      if (raised) {
        io.to(`mods-${code}`).emit("hand-raised", { name: socket.userName });
        if (attendanceLog[socket.id]) Attendance.findByIdAndUpdate(attendanceLog[socket.id], { $inc: { handRaisedCount: 1 } }).catch(() => {});
      }
    });

    socket.on("send-reaction", ({ emoji } = {}) => {
      if (inRoom() && EMOJIS.includes(emoji)) io.to(socket.meetingCode).emit("reaction-received", { emoji, name: socket.userName });
    });

    socket.on("toggle-media", ({ type, enabled } = {}) => {
      if (!inRoom()) return;
      const code = socket.meetingCode, u = rooms[code][socket.id];
      if (type === "audio") u.mic = !!enabled;
      else if (type === "video") u.cam = !!enabled;
      else return;
      io.to(code).emit("participants-update", listRoom(code));
    });

    // ================= HOST CONTROLS =================
    const target = (id) => (inRoom() && rooms[socket.meetingCode][id]) ? id : null;

    socket.on("host-mute-participant", ({ targetSocketId } = {}) => { if (socket.isMod && target(targetSocketId)) io.to(targetSocketId).emit("force-mute"); });
    socket.on("host-disable-camera", ({ targetSocketId } = {}) => { if (socket.isMod && target(targetSocketId)) io.to(targetSocketId).emit("force-camera-off"); });

    socket.on("host-remove-participant", ({ targetSocketId } = {}) => {
      if (!socket.isMod || !target(targetSocketId)) return;
      const code = socket.meetingCode, u = rooms[code][targetSocketId];
      (removed[code] = removed[code] || new Set()).add(u.userId);
      io.to(targetSocketId).emit("force-remove");
    });

    const savePerms = async (patch) => {
      const code = socket.meetingCode;
      Object.assign(meta[code], patch);
      const set = {};
      if ("chatAllowed" in patch) set["participantPermissions.chatAllowed"] = patch.chatAllowed;
      if ("shareAllowed" in patch) set["participantPermissions.screenShareAllowed"] = patch.shareAllowed;
      await Meeting.updateOne({ meetingCode: code }, set);
      io.to(code).emit("permissions-changed", { chatAllowed: meta[code].chatAllowed, shareAllowed: meta[code].shareAllowed });
    };
    socket.on("host-toggle-chat", ({ allowed } = {}) => { if (socket.isMod && inRoom()) savePerms({ chatAllowed: !!allowed }).catch(() => {}); });
    socket.on("host-toggle-screenshare", ({ allowed } = {}) => { if (socket.isMod && inRoom()) savePerms({ shareAllowed: !!allowed }).catch(() => {}); });
    socket.on("host-toggle-lock", ({ isLocked } = {}) => {
      if (socket.isMod && inRoom()) Meeting.updateOne({ meetingCode: socket.meetingCode }, { isLocked: !!isLocked }).catch(() => {});
    });

    socket.on("host-announcement", ({ message } = {}) => {
      message = clip(message, 400);
      if (socket.isMod && inRoom() && message)
        io.to(socket.meetingCode).emit("announcement", { message, from: socket.userName, time: new Date().toISOString() });
    });

    socket.on("recording-status", ({ isRecording } = {}) => {
      if (socket.isMod && inRoom()) io.to(socket.meetingCode).emit("recording-status", { isRecording: !!isRecording });
    });

    socket.on("share-chapter", async ({ chapterId } = {}) => {
      if (!socket.isMod || !inRoom()) return;
      try {
        const m = await Meeting.findOne({ meetingCode: socket.meetingCode }).select("_id");
        const ch = await Chapter.findOne({ _id: chapterId, meeting: m._id }).select("title");
        if (ch) io.to(socket.meetingCode).emit("chapter-shared", { chapterId: String(ch._id), title: ch.title });
      } catch (e) { /* invalid id */ }
    });

    // ================= SCREEN SHARE =================
    socket.on("screen-share-start", () => {
      if (!inRoom()) return;
      if (!socket.isMod && meta[socket.meetingCode].shareAllowed === false) return socket.emit("screenshare-blocked");
      socket.to(socket.meetingCode).emit("screen-share-start", { socketId: socket.id, name: socket.userName });
    });
    socket.on("screen-share-stop", () => { if (inRoom()) socket.to(socket.meetingCode).emit("screen-share-stop", { socketId: socket.id }); });

    // ================= LIVE QUESTIONS =================
    socket.on("host-send-question", async ({ questionText, options, correctIndex } = {}) => {
      if (!socket.isMod || !inRoom()) return;
      const code = socket.meetingCode;
      questionText = clip(questionText, 300);
      options = (Array.isArray(options) ? options : []).map((o) => clip(o, 120)).filter(Boolean).slice(0, 6);
      if (!questionText || options.length < 2) return;
      const ci = Number.isInteger(correctIndex) && correctIndex >= 0 && correctIndex < options.length ? correctIndex : undefined;
      try {
        const doc = await Meeting.findOneAndUpdate(
          { meetingCode: code },
          { $push: { questions: { questionText, options, correctOption: ci } } },
          { new: true }
        );
        const q = doc.questions[doc.questions.length - 1];
        io.to(code).emit("new-question", { questionId: String(q._id), questionText, options });
      } catch (e) { console.error("question:", e.message); }
    });

    socket.on("participant-answer", async ({ questionId, answer } = {}) => {
      if (!inRoom() || socket.isMod) return;
      const code = socket.meetingCode;
      answer = clip(answer, 200);
      try {
        const doc = await Meeting.findOne({ meetingCode: code, "questions._id": questionId }, { "questions.$": 1 });
        const q = doc && doc.questions[0];
        if (!q || !q.options.includes(answer)) return;
        const hasKey = q.correctOption !== undefined && q.correctOption !== null;
        const isCorrect = hasKey ? q.options[q.correctOption] === answer : undefined;

        const res = await Meeting.updateOne(
          { meetingCode: code, questions: { $elemMatch: { _id: q._id, "responses.participant": { $ne: socket.userId } } } },
          { $push: { "questions.$.responses": { participant: socket.userId, participantName: socket.userName, answer, isCorrect } } }
        );
        if (!res.modifiedCount) return socket.emit("answer-saved", { questionId, duplicate: true });

        socket.emit("answer-saved", { questionId, answer, isCorrect, correctAnswer: hasKey ? q.options[q.correctOption] : null });
        const fresh = await Meeting.findOne({ meetingCode: code, "questions._id": q._id }, { "questions.$": 1 });
        io.to(`mods-${code}`).emit("question-results-update", {
          questionId: String(q._id),
          responses: fresh.questions[0].responses.map((r) => ({ name: r.participantName, answer: r.answer, isCorrect: r.isCorrect })),
        });
        if (attendanceLog[socket.id]) Attendance.findByIdAndUpdate(attendanceLog[socket.id], { $inc: { questionsAnswered: 1 } }).catch(() => {});
      } catch (e) { console.error("answer:", e.message); }
    });

    // ================= WHITEBOARD (teacher draws, everyone sees) =================
    const pt = (p) => ({ x: num(p && p.x, 0, 1, 0), y: num(p && p.y, 0, 1, 0) });
    socket.on("wb-draw", (d = {}) => {
      if (socket.isMod && inRoom()) socket.to(socket.meetingCode).emit("wb-draw", { a: pt(d.a), b: pt(d.b), c: clip(d.c, 9), w: num(d.w, 1, 40, 4) });
    });
    socket.on("wb-clear", () => { if (socket.isMod && inRoom()) socket.to(socket.meetingCode).emit("wb-clear"); });
    socket.on("wb-visibility", ({ open } = {}) => { if (socket.isMod && inRoom()) io.to(socket.meetingCode).emit("wb-visibility", { open: !!open }); });

    // ================= END / LEAVE =================
    socket.on("host-end-meeting", async () => {
      if (!socket.isMod || !socket.meetingCode) return;
      const code = socket.meetingCode;
      try { await Meeting.updateOne({ meetingCode: code }, { status: "ended", endedAt: new Date() }); } catch (e) {}
      io.to(code).emit("meeting-ended");
      io.to(`waiting-${code}`).emit("meeting-ended");
      delete rooms[code]; delete waiting[code]; delete admitted[code]; delete removed[code]; delete meta[code];
    });

    async function leave() {
      const code = socket.meetingCode;
      if (!code) return;
      socket.meetingCode = null;

      if (rooms[code] && rooms[code][socket.id]) {
        const name = rooms[code][socket.id].name;
        delete rooms[code][socket.id];
        io.to(code).emit("participants-update", listRoom(code));
        socket.to(code).emit("user-left", { socketId: socket.id });
        system(code, `${name} left`);
      }
      if (waiting[code] && waiting[code][socket.id]) {
        delete waiting[code][socket.id];
        io.to(`mods-${code}`).emit("waiting-room-update", listWait(code));
      }
      const id = attendanceLog[socket.id];
      if (id) {
        delete attendanceLog[socket.id];
        try {
          const rec = await Attendance.findById(id);
          if (rec) { rec.leftAt = new Date(); rec.durationMinutes = Math.round((rec.leftAt - rec.joinedAt) / 60000); await rec.save(); }
        } catch (e) {}
      }
    }
    socket.on("leave-room", leave);
    socket.on("disconnect", leave);
  });
}

module.exports = initMeetingSocket;