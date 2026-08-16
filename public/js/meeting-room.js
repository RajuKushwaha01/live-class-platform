const socket = io();
const { meetingCode, userId, userName, role, isHost } = window.MEETING_DATA;

let localStream = null;
let webrtc = null;
let micOn = true, camOn = true, handRaised = false;

const videoGrid = document.getElementById("videoGrid");
const chatBox = document.getElementById("chatBox");
const participantsList = document.getElementById("participantsList");
const questionsList = document.getElementById("questionsList");

// Register this socket for direct notifications too (so alerts work inside the room as well)
socket.emit("register-user", { userId });

async function initMedia() {
  if (!window.isSecureContext) {
    showMediaWarning("⚠️ This page isn't secure (HTTPS). Camera/mic are blocked. Use the https:// link.", false);
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    console.warn("getUserMedia failed:", err.name);
    if (err.name === "NotAllowedError") showMediaWarning("🚫 Permission denied. Click the padlock icon → Allow Camera & Mic → reload.", true);
    else if (err.name === "NotFoundError") showMediaWarning("📷 No camera found. Joining with what's available.", false);
    else if (err.name === "NotReadableError") showMediaWarning("⚠️ Camera/mic is busy in another app. Close it and click Retry.", true);
    else showMediaWarning("⚠️ Couldn't access camera. Joined with audio only.", true);

    if (!localStream) {
      try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); camOn = false; }
      catch { localStream = new MediaStream(); micOn = false; camOn = false; }
    }
  }

  document.getElementById("localVideo").srcObject = localStream;
  webrtc = new WebRTCManager(socket, localStream);
  updateMicUI(); updateCamUI();
  socket.emit("join-room", { meetingCode, userId, name: userName, role, isHost });
}

function showMediaWarning(msg, withRetry) {
  let banner = document.getElementById("mediaWarningBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "mediaWarningBanner";
    banner.className = "fixed top-16 left-1/2 -translate-x-1/2 bg-yellow-500/20 border border-yellow-500 text-yellow-200 text-xs px-4 py-2 rounded-lg z-50 flex items-center gap-3 max-w-md text-center";
    document.body.appendChild(banner);
  }
  banner.innerHTML = `<span>${msg}</span>` + (withRetry ? `<button onclick="retryMedia()" class="bg-yellow-500 text-black px-2 py-1 rounded text-xs font-semibold shrink-0">Retry</button>` : "");
}

async function retryMedia() {
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream.getTracks().forEach((t) => t.stop());
    localStream = newStream;
    webrtc.localStream = newStream;
    document.getElementById("localVideo").srcObject = newStream;
    micOn = true; camOn = true;
    updateMicUI(); updateCamUI();
    document.getElementById("mediaWarningBanner")?.remove();
    Object.values(webrtc.peers).forEach((pc) => {
      newStream.getTracks().forEach((track) => {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === track.kind);
        if (sender) sender.replaceTrack(track); else pc.addTrack(track, newStream);
      });
    });
  } catch { alert("Still blocked. Allow Camera + Microphone in your browser's site settings, then reload."); }
}

initMedia();

// ---------- PEER CONNECTIONS (audio unmuted on remote, video plays automatically) ----------
socket.on("user-joined", async ({ socketId, name }) => {
  addVideoTile(socketId, name);
  await webrtc.callUser(socketId, updateRemoteStream, updateConnBadge);
});

socket.on("webrtc-offer", async ({ from, offer, name }) => {
  addVideoTile(from, name);
  await webrtc.handleOffer(from, offer, updateRemoteStream, updateConnBadge);
});

socket.on("webrtc-answer", ({ from, answer }) => webrtc.handleAnswer(from, answer));
socket.on("webrtc-ice-candidate", ({ from, candidate }) => webrtc.handleIceCandidate(from, candidate));

socket.on("user-left", ({ socketId }) => { webrtc.closePeer(socketId); document.getElementById(`tile-${socketId}`)?.remove(); });

function addVideoTile(socketId, name) {
  if (document.getElementById(`tile-${socketId}`)) return;
  const tile = document.createElement("div");
  tile.id = `tile-${socketId}`;
  tile.className = "video-tile bg-slate-800 rounded-xl overflow-hidden relative aspect-video";
  tile.innerHTML = `
    <video id="video-${socketId}" autoplay playsinline class="w-full h-full object-cover"></video>
    <span class="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">${name}</span>
  `;
  videoGrid.appendChild(tile);
}

function updateRemoteStream(socketId, stream) {
  const video = document.getElementById(`video-${socketId}`);
  if (video) {
    video.srcObject = stream;
    video.muted = false; // ⭐ ensures remote audio is actually audible
    video.play().catch(() => {}); // handles autoplay-block edge cases
  }
}

function updateConnBadge(socketId, state) {
  const tile = document.getElementById(`tile-${socketId}`);
  if (!tile) return;
  let badge = tile.querySelector(".conn-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "conn-badge absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full";
    tile.appendChild(badge);
  }
  const map = {
    connected: ["bg-green-500/30 text-green-300", "Connected"],
    connecting: ["bg-yellow-500/30 text-yellow-300", "Connecting..."],
    failed: ["bg-red-500/30 text-red-300", "Reconnecting..."],
    disconnected: ["bg-red-500/30 text-red-300", "Reconnecting..."],
  };
  const [cls, label] = map[state] || ["bg-gray-500/30 text-gray-300", state];
  badge.className = `conn-badge absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full ${cls}`;
  badge.textContent = label;
  if (state === "connected") setTimeout(() => badge.remove(), 3000);
}

function updateMicUI() {
  const btn = document.getElementById("micBtn");
  btn.innerHTML = `<i data-lucide="${micOn ? "mic" : "mic-off"}"></i>`;
  btn.classList.toggle("bg-red-600", !micOn);
  lucide.createIcons();
}

function updateCamUI() {
  const btn = document.getElementById("camBtn");
  btn.innerHTML = `<i data-lucide="${camOn ? "video" : "video-off"}"></i>`;
  btn.classList.toggle("bg-red-600", !camOn);
  lucide.createIcons();
}

document.getElementById("micBtn").addEventListener("click", () => {
  micOn = !micOn; webrtc.toggleAudio(micOn); updateMicUI();
  socket.emit("toggle-media", { meetingCode, type: "audio", enabled: micOn, name: userName });
});

document.getElementById("camBtn").addEventListener("click", () => {
  camOn = !camOn; webrtc.toggleVideo(camOn); updateCamUI();
  socket.emit("toggle-media", { meetingCode, type: "video", enabled: camOn, name: userName });
});

// ---------- CHAT ----------
document.getElementById("chatForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("chatInput");
  if (!input || !input.value.trim()) return;
  socket.emit("chat-message", { meetingCode, message: input.value, name: userName, userId });
  input.value = "";
});

socket.on("chat-message", (data) => {
  const div = document.createElement("div");
  if (data.system) {
    div.className = "text-gray-500 text-xs italic text-center";
    div.textContent = data.message;
  } else {
    div.className = "bg-white/10 rounded-lg p-2";
    div.innerHTML = `<span class="text-indigo-400 text-xs font-semibold">${data.senderName}</span>
      <p class="text-white text-sm">${data.message}</p>`;
  }
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
});

// ---------- PARTICIPANTS ----------
socket.on("participants-update", (users) => {
  if (!participantsList) return;
  participantsList.innerHTML = "";
  Object.entries(users).forEach(([socketId, u]) => {
    const div = document.createElement("div");
    div.className = "flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 text-white text-sm";
    div.innerHTML = `<span>${u.name} ${u.handRaised ? "✋" : ""}</span>`;
    if (isHost && u.userId !== userId) {
      div.innerHTML += `
        <div class="flex gap-1">
          <button onclick="muteParticipant('${socketId}')" class="text-yellow-400 text-xs hover:underline">Mute</button>
          <button onclick="disableCameraParticipant('${socketId}')" class="text-orange-400 text-xs hover:underline">Cam Off</button>
          <button onclick="removeParticipant('${socketId}')" class="text-red-400 text-xs hover:underline">Remove</button>
        </div>`;
    }
    participantsList.appendChild(div);
  });
});

function muteParticipant(targetSocketId) {
  socket.emit("host-mute-participant", { meetingCode, targetSocketId });
}

function disableCameraParticipant(targetSocketId) {
  socket.emit("host-disable-camera", { meetingCode, targetSocketId });
}

function removeParticipant(targetSocketId) {
  socket.emit("host-remove-participant", { meetingCode, targetSocketId });
}

socket.on("force-mute", () => {
  micOn = false;
  webrtc.toggleAudio(false);
  updateMicUI();
  alert("Host muted your microphone.");
});

socket.on("force-camera-off", () => {
  camOn = false;
  webrtc.toggleVideo(false);
  updateCamUI();
  alert("Host disabled your camera.");
});

socket.on("force-remove", () => {
  alert("You were removed by the host.");
  window.location.href = "/participant/dashboard";
});

// ---------- RAISE HAND ----------
document.getElementById("handBtn")?.addEventListener("click", () => {
  handRaised = !handRaised;
  socket.emit("raise-hand", { meetingCode, name: userName, raised: handRaised });
  document.getElementById("handBtn").classList.toggle("bg-yellow-500", handRaised);
});

// ---------- REACTIONS ----------
document.getElementById("reactionBtn")?.addEventListener("click", () => {
  const emojis = ["👍", "😂", "❤️", "🎉", "😮"];
  const emoji = emojis[Math.floor(Math.random() * emojis.length)];
  socket.emit("send-reaction", { meetingCode, name: userName, emoji });
});

socket.on("reaction-received", ({ name, emoji }) => {
  const el = document.createElement("div");
  el.textContent = emoji;
  el.style.cssText = "position:fixed;bottom:100px;left:" + (Math.random() * 80 + 10) + "%;font-size:2rem;animation:floatUp 2s ease forwards;z-index:50;";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
});

// ---------- SCREEN SHARE ----------
let sharingScreen = false;
document.getElementById("screenBtn")?.addEventListener("click", async () => {
  if (!sharingScreen) {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      await webrtc.replaceVideoTrack(screenTrack);
      document.getElementById("localVideo").srcObject = screenStream;
      sharingScreen = true;
      socket.emit("screen-share-start", { meetingCode, name: userName });
      screenTrack.onended = stopScreenShare;
    } catch (e) {
      console.log("Screen share cancelled");
    }
  } else {
    stopScreenShare();
  }
});

async function stopScreenShare() {
  const camTrack = localStream.getVideoTracks()[0];
  await webrtc.replaceVideoTrack(camTrack);
  document.getElementById("localVideo").srcObject = localStream;
  sharingScreen = false;
  socket.emit("screen-share-stop", { meetingCode });
}

// ---------- QUESTIONS / POLLS ----------
if (isHost) {
  document.getElementById("questionForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const questionText = document.getElementById("qText").value;
    const options = document.getElementById("qOptions").value.split(",").map((s) => s.trim());
    socket.emit("host-send-question", { meetingCode, questionText, options });
    e.target.reset();
  });
}

socket.on("new-question", ({ questionId, questionText, options }) => {
  if (!questionsList) return;
  const div = document.createElement("div");
  div.className = "bg-white/10 rounded-lg p-3 my-2";
  let optionsHtml = options
    .map((opt) => `<button onclick="answerQuestion('${questionId}','${opt}')" class="block w-full text-left bg-white/5 hover:bg-indigo-600 rounded px-2 py-1 my-1 text-xs text-white">${opt}</button>`)
    .join("");
  div.innerHTML = `<p class="font-semibold mb-2 text-white text-sm">${questionText}</p>${isHost ? '<div id="results-' + questionId + '" class="text-xs text-gray-400"></div>' : optionsHtml}`;
  questionsList.appendChild(div);
});

function answerQuestion(questionId, answer) {
  socket.emit("participant-answer", { meetingCode, questionId, answer, userId, name: userName });
  alert("Answer submitted: " + answer);
}

socket.on("question-results-update", ({ questionId, responses }) => {
  const resultDiv = document.getElementById(`results-${questionId}`);
  if (resultDiv) {
    resultDiv.innerHTML = responses.map((r) => `${r.participantName}: ${r.answer}`).join("<br>");
  }
});

// ---------- WHITEBOARD ----------
const wbBtn = document.getElementById("whiteboardBtn");
const wbPanel = document.getElementById("whiteboardPanel");
const canvas = document.getElementById("whiteboard");
let ctx = null;
let drawing = false;

if (canvas) {
  ctx = canvas.getContext("2d");
  canvas.addEventListener("mousedown", (e) => { drawing = true; ctx.beginPath(); ctx.moveTo(e.offsetX, e.offsetY); });
  canvas.addEventListener("mousemove", (e) => {
    if (!drawing) return;
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();
    socket.emit("whiteboard-draw", { meetingCode, drawData: { x: e.offsetX, y: e.offsetY, type: "draw" } });
  });
  canvas.addEventListener("mouseup", () => (drawing = false));
}

if (wbBtn && wbPanel) {
  wbBtn.addEventListener("click", () => wbPanel.classList.toggle("hidden"));
}

socket.on("whiteboard-draw", (data) => {
  if (ctx) {
    ctx.lineTo(data.x, data.y);
    ctx.stroke();
  }
});

document.getElementById("clearBoard")?.addEventListener("click", () => {
  if (ctx && canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit("whiteboard-clear", { meetingCode });
  }
});

socket.on("whiteboard-clear", () => {
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// ---------- RECORDING (host only) ----------
if (isHost) {
  let recording = false;
  document.getElementById("recordBtn")?.addEventListener("click", () => {
    recording = !recording;
    socket.emit("recording-status", { meetingCode, isRecording: recording });
  });
}

socket.on("recording-status", ({ isRecording }) => {
  document.getElementById("recordingBadge")?.classList.toggle("hidden", !isRecording);
});

// ---------- TABS ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.replace("text-white", "text-gray-400"));
    btn.classList.replace("text-gray-400", "text-white");
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.add("hidden"));
    document.getElementById(`tab-${btn.dataset.tab}`)?.classList.remove("hidden");
  });
});

// ---------- WAITING ROOM (host side) ----------
socket.on("waiting-room-update", (waitingList) => {
  if (!isHost) return;
  let panel = document.getElementById("waitingRoomPanel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "waitingRoomPanel";
    panel.className = "fixed top-20 right-4 glass-card p-4 w-72 z-50 rounded-xl bg-slate-900/90 border border-slate-700 shadow-2xl";
    document.body.appendChild(panel);
  }
  if (!waitingList || waitingList.length === 0) {
    panel.remove();
    return;
  }
  panel.innerHTML = `<h4 class="text-white text-sm font-semibold mb-2">🚪 Waiting Room (${waitingList.length})</h4>` +
    waitingList.map(u => `
      <div class="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 mb-2 text-sm text-white">
        <span>${u.name}</span>
        <div class="flex gap-1">
          <button onclick="admitUser('${u.socketId || ''}')" class="bg-green-600 hover:bg-green-500 text-xs px-2 py-1 rounded">Admit</button>
          <button onclick="denyUser('${u.socketId || ''}')" class="bg-red-600 hover:bg-red-500 text-xs px-2 py-1 rounded">Deny</button>
        </div>
      </div>
    `).join("");
});

function admitUser(targetSocketId) {
  socket.emit("admit-participant", { meetingCode, targetSocketId });
}

function denyUser(targetSocketId) {
  socket.emit("deny-participant", { meetingCode, targetSocketId });
}

// ---------- LOCK MEETING TOGGLE (host) ----------
function toggleLockMeeting() {
  fetch(`/invite/${meetingCode}/toggle-lock`, { method: "POST" })
    .then((r) => r.json())
    .then((data) => socket.emit("host-toggle-lock", { meetingCode, isLocked: data.isLocked }));
}

socket.on("meeting-lock-changed", ({ isLocked }) => {
  const badge = document.getElementById("lockBadge");
  if (badge) badge.classList.toggle("hidden", !isLocked);
});

// ---------- CHAT PERMISSION TOGGLE ----------
function toggleChatPermission(allowed) {
  socket.emit("host-toggle-chat", { meetingCode, allowed });
}

socket.on("chat-permission-changed", ({ allowed }) => {
  const input = document.getElementById("chatInput");
  if (input) {
    input.disabled = !allowed && !isHost;
    input.placeholder = allowed ? "Type a message..." : "Chat disabled by host";
  }
});

socket.on("chat-blocked", ({ message }) => alert(message));

// ---------- SCREEN SHARE PERMISSION ----------
socket.on("screenshare-permission-changed", ({ allowed }) => {
  const btn = document.getElementById("screenBtn");
  if (btn) btn.disabled = !allowed && !isHost;
});

socket.on("screenshare-blocked", () => alert("Screen sharing has been disabled by the host."));

// ---------- MEETING ENDED BY HOST ----------
socket.on("meeting-ended-by-host", () => {
  alert("The host has ended this meeting.");
  window.location.href = "/participant/dashboard";
});

window.addEventListener("beforeunload", () => socket.emit("leave-room"));
if (window.lucide) lucide.createIcons();

// ---------- SPEAKER VIEW (auto-activates beyond 6 participants) ----------
const SPEAKER_VIEW_THRESHOLD = 6;

socket.on("participants-update", (users) => {
  const count = Object.keys(users).length;
  if (count > SPEAKER_VIEW_THRESHOLD) {
    enableSpeakerView();
  }
});

function enableSpeakerView() {
  const tiles = document.querySelectorAll(".video-tile");
  tiles.forEach((tile, i) => {
    // Keep host + first active speaker visible as video; rest become audio-only avatar tiles
    if (i > 1) {
      const video = tile.querySelector("video");
      if (video) video.style.display = "none";
      if (!tile.querySelector(".audio-only-badge")) {
        const badge = document.createElement("div");
        badge.className = "audio-only-badge absolute inset-0 flex items-center justify-center bg-slate-900 text-2xl";
        badge.textContent = "🎧";
        tile.appendChild(badge);
      }
    }
  });

  // Warn host about mesh limits
  if (isHost && !document.getElementById("scaleBanner")) {
    const banner = document.createElement("div");
    banner.id = "scaleBanner";
    banner.className = "fixed top-16 left-1/2 -translate-x-1/2 bg-yellow-500/20 border border-yellow-500 text-yellow-300 text-xs px-4 py-2 rounded-lg z-50";
    banner.textContent = "⚠️ Large class detected — switched to audio-only for most tiles to keep the call stable.";
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 6000);
  }
}