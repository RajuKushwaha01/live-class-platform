(function () {
  "use strict";
  var R = window.ROOM;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var icons = function () { if (window.lucide) window.lucide.createIcons(); };
  var initials = function (n) { return ((n || "?").trim().split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join("") || "?").toUpperCase(); };
  var isMobile = function () { return window.matchMedia("(max-width:900px)").matches; };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function setIcon(btn, name) { var s = $(".ic", btn); if (s) { s.innerHTML = '<i data-lucide="' + name + '"></i>'; icons(); } }
  function fmtTime(t) { try { return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
  function safeUrl(u) { return /^(https?:\/\/|\/)/i.test(u || "") ? u : "#"; }
  function toast(msg, type, ms) {
    var box = $("#toasts"), t = el("div", "toast " + (type || ""), msg);
    box.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("in"); });
    setTimeout(function () { t.classList.remove("in"); setTimeout(function () { t.remove(); }, 300); }, ms || 4200);
  }

  var socket = io();
  var webrtc = null, localStream = null, selfId = null;
  var micOn = true, camOn = true, handUp = false, sharing = false;
  var chatAllowed = R.perms.chat, shareAllowed = R.perms.share;
  var people = {};
  var stage = $("#stage");
  var audioCtx = null;

  /* =============== tiles =============== */
  function updateCount() {
    stage.dataset.n = stage.children.length;
    $("#countPill").textContent = Object.keys(people).length || 1;
    $("#peopleCount").textContent = Object.keys(people).length || 1;
  }
  function addTile(sid, name, u) {
    var t = document.getElementById("tile-" + sid);
    if (t) return t;
    t = el("div", "tile" + (sid === "local" ? " local" : " connecting"));
    t.id = "tile-" + sid; t.dataset.sid = sid;
    var v = el("video"); v.autoplay = true; v.playsInline = true; if (sid === "local") v.muted = true;
    var av = el("div", "av"); av.appendChild(el("span", "", initials(name)));
    var bar = el("div", "tile-bar");
    bar.appendChild(el("span", "tile-name", name + (sid === "local" ? " (You)" : "")));
    var ic = el("span", "tile-ic"); ic.innerHTML = '<i data-lucide="mic-off"></i>'; bar.appendChild(ic);
    t.appendChild(v); t.appendChild(av); t.appendChild(bar);
    t.appendChild(el("span", "tile-hand", "✋"));
    if (u && u.isHost) t.appendChild(el("span", "tile-role", "Teacher"));
    else if (sid === "local" && R.isHost) t.appendChild(el("span", "tile-role", "Teacher"));
    t.appendChild(el("span", "tile-conn", "Connecting…"));
    if (sid === "local") stage.insertBefore(t, stage.firstChild); else stage.appendChild(t);
    icons(); updateCount();
    return t;
  }
  function removeTile(sid) {
    var t = document.getElementById("tile-" + sid);
    if (t) { if (t._timer) clearInterval(t._timer); t.remove(); }
    if (webrtc) webrtc.closePeer(sid);
    updateCount();
  }
  function applyTile(t, o) {
    if (!t) return;
    t.classList.toggle("mic-off", !o.mic);
    t.classList.toggle("cam-off", !o.cam);
    t.classList.toggle("hand", !!o.handRaised);
  }
  function watchSpeaking(stream, tile) {
    try {
      if (!stream.getAudioTracks().length) return;
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      audioCtx = audioCtx || new AC();
      var an = audioCtx.createAnalyser(); an.fftSize = 512;
      audioCtx.createMediaStreamSource(new MediaStream([stream.getAudioTracks()[0]])).connect(an);
      var buf = new Uint8Array(an.frequencyBinCount);
      tile._timer = setInterval(function () {
        an.getByteFrequencyData(buf);
        var s = 0; for (var i = 0; i < buf.length; i++) s += buf[i];
        tile.classList.toggle("speaking", s / buf.length > 16);
      }, 200);
    } catch (e) {}
  }
  document.addEventListener("click", function () {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    $$("video").forEach(function (v) { if (v.paused && v.srcObject) v.play().catch(function () {}); });
  });

  /* =============== media =============== */
  function mediaWarn(msg, retry) {
    var b = $("#mediaWarn");
    if (!b) {
      b = el("div", "alert err"); b.id = "mediaWarn";
      b.style.cssText = "position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:80;max-width:520px;display:flex;gap:12px;align-items:center";
      document.body.appendChild(b);
    }
    b.innerHTML = ""; b.appendChild(el("span", "", msg));
    if (retry) { var r = el("button", "btn btn-primary btn-sm", "Retry"); r.onclick = retryMedia; b.appendChild(r); }
    var x = el("button", "btn btn-ghost btn-sm", "✕"); x.onclick = function () { b.remove(); }; b.appendChild(x);
  }
  var VIDEO_C = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } };
  var AUDIO_C = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  async function initMedia() {
    var local = addTile("local", R.me.name, { isHost: R.isHost });
    if (!window.isSecureContext) mediaWarn("This page is not secure (HTTPS), so the browser blocks camera/mic. Use the https:// link.", false);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_C, audio: AUDIO_C });
    } catch (err) {
      var msg = err.name === "NotAllowedError" ? "Camera/mic permission denied. Click the padlock in the address bar → Allow → reload."
        : err.name === "NotReadableError" ? "Camera/mic is in use by another app. Close it and press Retry."
        : err.name === "NotFoundError" ? "No camera found on this device." : "Could not start your camera.";
      mediaWarn(msg, err.name !== "NotFoundError");
      try { localStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_C }); camOn = false; }
      catch (e2) { localStream = new MediaStream(); micOn = false; camOn = false; }
    }
    if (!localStream.getVideoTracks().length) camOn = false;
    if (!localStream.getAudioTracks().length) micOn = false;
    $("video", local).srcObject = localStream;
    watchSpeaking(localStream, local);
    webrtc = new WebRTCManager(socket, localStream);
    syncLocalUI();
    socket.emit("join-room", { meetingCode: R.code });
  }

  async function retryMedia() {
    try {
      var ns = await navigator.mediaDevices.getUserMedia({ video: VIDEO_C, audio: AUDIO_C });
      if (localStream) localStream.getTracks().forEach(function (t) { t.stop(); });
      localStream = ns; webrtc.localStream = ns;
      $("video", $("#tile-local")).srcObject = ns;
      micOn = true; camOn = true;
      Object.keys(webrtc.peers).forEach(function (sid) {
        var pc = webrtc.peers[sid];
        ns.getTracks().forEach(function (track) {
          var s = pc.getSenders().find(function (x) { return x.track && x.track.kind === track.kind; });
          if (s) s.replaceTrack(track); else pc.addTrack(track, ns);
        });
      });
      var w = $("#mediaWarn"); if (w) w.remove();
      syncLocalUI(); pushMedia();
    } catch (e) { toast("Still blocked. Allow Camera + Microphone in your browser settings, then reload.", "error", 6000); }
  }
  function pushMedia() {
    socket.emit("toggle-media", { type: "audio", enabled: micOn });
    socket.emit("toggle-media", { type: "video", enabled: camOn });
  }
  function syncLocalUI() {
    var mb = $("#micBtn"), cb = $("#camBtn");
    mb.classList.toggle("off", !micOn); setIcon(mb, micOn ? "mic" : "mic-off");
    cb.classList.toggle("off", !camOn); setIcon(cb, camOn ? "video" : "video-off");
    applyTile($("#tile-local"), { mic: micOn, cam: camOn, handRaised: handUp });
  }

  $("#micBtn").onclick = function () {
    if (!localStream.getAudioTracks().length) return retryMedia();
    micOn = !micOn; webrtc.toggleAudio(micOn); syncLocalUI(); socket.emit("toggle-media", { type: "audio", enabled: micOn });
  };
  $("#camBtn").onclick = function () {
    if (!localStream.getVideoTracks().length) return retryMedia();
    camOn = !camOn; webrtc.toggleVideo(camOn); syncLocalUI(); socket.emit("toggle-media", { type: "video", enabled: camOn });
  };
  $("#handBtn").onclick = function () {
    handUp = !handUp; $("#handBtn").classList.toggle("on", handUp);
    socket.emit("raise-hand", { raised: handUp }); syncLocalUI();
  };

  /* ---- screen share ---- */
  $("#screenBtn").onclick = async function () {
    if (sharing) return stopShare();
    if (!shareAllowed && !R.isHost) return toast("Screen sharing is disabled by the teacher.", "error");
    try {
      var ss = await navigator.mediaDevices.getDisplayMedia({ video: true });
      var track = ss.getVideoTracks()[0];
      await webrtc.replaceVideoTrack(track);
      $("video", $("#tile-local")).srcObject = ss;
      $("#tile-local").classList.add("sharing");
      sharing = true; $("#screenBtn").classList.add("on");
      socket.emit("screen-share-start");
      track.onended = stopShare;
    } catch (e) { /* cancelled */ }
  };
  async function stopShare() {
    if (!sharing) return;
    sharing = false; $("#screenBtn").classList.remove("on");
    var cam = localStream.getVideoTracks()[0];
    if (cam) await webrtc.replaceVideoTrack(cam);
    $("video", $("#tile-local")).srcObject = localStream;
    $("#tile-local").classList.remove("sharing");
    socket.emit("screen-share-stop");
  }
  socket.on("screen-share-start", function (d) { var t = document.getElementById("tile-" + d.socketId); if (t) t.classList.add("presenting"); toast(d.name + " is sharing their screen"); });
  socket.on("screen-share-stop", function (d) { var t = document.getElementById("tile-" + d.socketId); if (t) t.classList.remove("presenting"); });
  socket.on("screenshare-blocked", function () { stopShare(); toast("Screen sharing is disabled by the teacher.", "error"); });

  /* =============== WebRTC wiring =============== */
  function onRemoteStream(sid, stream) {
    var t = addTile(sid, (people[sid] && people[sid].name) || "Participant", people[sid]);
    var v = $("video", t);
    if (v.srcObject !== stream) v.srcObject = stream;
    v.muted = false;
    v.play().catch(function () { toast("Click anywhere on the page to enable sound", "", 6000); });
    if (!t._watched) { t._watched = true; watchSpeaking(stream, t); }
  }
  function onConn(sid, state) {
    var t = document.getElementById("tile-" + sid); if (!t) return;
    t.classList.toggle("connecting", state !== "connected");
    $(".tile-conn", t).textContent = state === "failed" || state === "disconnected" ? "Reconnecting…" : "Connecting…";
  }
  socket.on("user-joined", async function (u) {
    addTile(u.socketId, u.name, u);
    try { await webrtc.callUser(u.socketId, onRemoteStream, onConn); } catch (e) { console.error(e); }
  });
  socket.on("webrtc-offer", async function (d) {
    addTile(d.from, d.name, people[d.from]);
    try { await webrtc.handleOffer(d.from, d.offer, onRemoteStream, onConn); } catch (e) { console.error(e); }
  });
  socket.on("webrtc-answer", function (d) { webrtc.handleAnswer(d.from, d.answer); });
  socket.on("webrtc-ice-candidate", function (d) { webrtc.handleIceCandidate(d.from, d.candidate); });
  socket.on("user-left", function (d) { removeTile(d.socketId); });

  /* =============== room state =============== */
  socket.on("room-joined", function (d) {
    selfId = d.selfSocketId; chatAllowed = d.chatAllowed; shareAllowed = d.shareAllowed;
    (d.history || []).forEach(function (m) { pushMsg(m, true); });
    applyPerms(); pushMedia(); renderMsgs();
  });
  socket.on("participants-update", function (list) {
    people = {};
    list.forEach(function (u) { people[u.socketId] = u; });
    $$(".tile", stage).forEach(function (t) { if (t.dataset.sid !== "local" && !people[t.dataset.sid]) removeTile(t.dataset.sid); });
    list.forEach(function (u) {
      if (u.socketId === selfId) return;
      applyTile(addTile(u.socketId, u.name, u), u);
    });
    renderPeople(); updateCount();
  });
  socket.on("permissions-changed", function (d) { chatAllowed = d.chatAllowed; shareAllowed = d.shareAllowed; applyPerms(); });
  function applyPerms() {
    if (!R.isHost) $("#screenBtn").disabled = !shareAllowed;
    updateComposer();
    if (R.isHost) { $("#swChat").checked = chatAllowed; $("#swShare").checked = shareAllowed; }
  }
  socket.on("hand-raised", function (d) { toast("✋ " + d.name + " raised a hand"); });
  socket.on("force-mute", function () { micOn = false; webrtc.toggleAudio(false); syncLocalUI(); socket.emit("toggle-media", { type: "audio", enabled: false }); toast("The teacher muted your microphone", "error"); });
  socket.on("force-camera-off", function () { camOn = false; webrtc.toggleVideo(false); syncLocalUI(); socket.emit("toggle-media", { type: "video", enabled: false }); toast("The teacher turned off your camera", "error"); });
  socket.on("force-remove", function () { showEnd("🚫", "You were removed", "The teacher removed you from this class."); });
  socket.on("meeting-ended", function () { showEnd("👋", "Class ended", "Thanks for joining! Your teacher has ended the session."); });
  socket.on("room-error", function (d) { showEnd("⚠️", "Can't join", d.message); });
  socket.on("auth-required", function () { location.href = "/auth/login"; });
  socket.io.on("reconnect", function () { location.reload(); });

  function showEnd(icon, title, msg) {
    if (localStream) localStream.getTracks().forEach(function (t) { t.stop(); });
    if (webrtc) Object.keys(webrtc.peers).forEach(function (s) { webrtc.closePeer(s); });
    $("#endIcon").textContent = icon; $("#endTitle").textContent = title; $("#endMsg").textContent = msg;
    $("#endBtnBack").href = R.home; $("#endScreen").classList.add("open");
  }

  /* =============== chat (public + private) =============== */
  var threads = { "public": { key: "public", title: "Everyone", msgs: [], unread: 0 } };
  var activeKey = "public", replyTo = null, tabNow = "chat", lastTyping = 0, typingT = null;

  function dmThread(userId, name) {
    var k = "dm:" + userId;
    if (!threads[k]) threads[k] = { key: k, title: name, userId: userId, msgs: [], unread: 0 };
    else if (name) threads[k].title = name;
    return threads[k];
  }
  if (!R.isHost) dmThread(R.hostId, R.hostName);

  function panelHidden() { return isMobile() && !$("#panel").classList.contains("open"); }

  function pushMsg(m, quiet) {
    var th;
    if (m.scope === "dm") { var other = m.from.userId === R.me.id ? m.to : m.from; th = dmThread(other.userId, other.name); }
    else th = threads["public"];
    th.msgs.push(m); if (th.msgs.length > 300) th.msgs.shift();
    var visible = tabNow === "chat" && activeKey === th.key && !panelHidden();
    if (visible) { appendMsg(m); scrollMsgs(); }
    else if (!quiet && !m.system && m.from && m.from.userId !== R.me.id) {
      th.unread++;
      if (m.scope === "dm") toast("💬 " + m.from.name + ": " + m.text.slice(0, 70), "", 5500);
    }
    renderThreads(); updateBadges();
  }
  function msgEl(m) {
    var mine = m.from && m.from.userId === R.me.id;
    var d = el("div", "msg" + (mine ? " mine" : "") + (m.system ? " sys" : "") + (m.announce ? " announce" : ""));
    if (m.system) { d.appendChild(el("div", "bub", (m.announce ? "📢 " : "") + m.text)); return d; }
    var av = el("span", "avatar", initials(m.from.name)); av.style.cssText = "width:30px;height:30px;border-radius:10px;font-size:11px";
    var bub = el("div", "bub");
    var nm = el("div", "nm", mine ? "You" : m.from.name);
    if (m.from.isHost) nm.appendChild(el("span", "badge b-accent", "Teacher"));
    bub.appendChild(nm);
    if (m.replyTo) { var q = el("div", "quote"); q.appendChild(el("b", "", m.replyTo.name + ": ")); q.appendChild(document.createTextNode(m.replyTo.text)); bub.appendChild(q); }
    bub.appendChild(el("div", "tx", m.text));
    bub.appendChild(el("div", "tm", fmtTime(m.time)));
    var rp = el("button", "rp"); rp.type = "button"; rp.title = "Reply"; rp.innerHTML = '<i data-lucide="reply"></i>';
    rp.onclick = function () { setReply(m); };
    d.appendChild(av); d.appendChild(bub); d.appendChild(rp);
    return d;
  }
  function appendMsg(m) { $("#msgs").appendChild(msgEl(m)); icons(); }
  function renderMsgs() {
    var box = $("#msgs"); box.innerHTML = "";
    threads[activeKey].msgs.forEach(function (m) { box.appendChild(msgEl(m)); });
    icons(); scrollMsgs();
  }
  function scrollMsgs() { var b = $("#msgs"); b.scrollTop = b.scrollHeight; }

  function renderThreads() {
    var box = $("#threads"); box.innerHTML = "";
    Object.keys(threads).forEach(function (k) {
      var th = threads[k];
      var label = k === "public" ? "💬 Everyone" : (R.isHost ? "🔒 " + th.title : "🔒 Teacher · " + th.title);
      var b = el("button", "thread" + (k === activeKey ? " on" : ""), label); b.type = "button";
      if (th.unread) b.appendChild(el("span", "ud", th.unread > 9 ? "9+" : th.unread));
      b.onclick = function () { switchThread(k); };
      box.appendChild(b);
    });
  }
  function switchThread(k) {
    activeKey = k; threads[k].unread = 0; clearReply();
    $("#typing").textContent = "";
    renderThreads(); renderMsgs(); updateComposer(); updateBadges();
  }
  function updateComposer() {
    var inp = $("#chatInput"), blocked = activeKey === "public" && !chatAllowed && !R.isHost;
    inp.disabled = blocked;
    inp.placeholder = blocked ? "Public chat is off — use the Teacher tab" : (activeKey === "public" ? "Message everyone…" : "Private message…");
  }
  function updateBadges() {
    var chat = 0; Object.keys(threads).forEach(function (k) { chat += threads[k].unread; });
    setBadge("chat", tabNow === "chat" && !panelHidden() ? threads[activeKey] && 0 : chat, chat);
    var o = $("#bd-open"); if (o) { o.textContent = chat; o.style.display = chat ? "grid" : "none"; }
  }
  function setBadge(name, _ignored, n) {
    var b = $("#bd-" + name); if (!b) return;
    if (typeof n === "undefined") n = _ignored;
    b.textContent = n > 9 ? "9+" : n; b.style.display = n ? "grid" : "none";
  }

  function setReply(m) {
    replyTo = { id: m.id, name: m.from.name, text: m.text.slice(0, 120) };
    $("#replyText").textContent = "Replying to " + m.from.name + ": " + m.text.slice(0, 60);
    $("#replyBar").hidden = false; $("#chatInput").focus();
  }
  function clearReply() { replyTo = null; $("#replyBar").hidden = true; }
  $("#replyCancel").onclick = clearReply;

  $("#chatForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var inp = $("#chatInput"), text = inp.value.trim(); if (!text) return;
    var th = threads[activeKey];
    if (th.key === "public") {
      if (!chatAllowed && !R.isHost) return toast("Public chat is off. Message the teacher privately.", "error");
      socket.emit("chat-message", { text: text, replyTo: replyTo });
    } else socket.emit("private-message", { toUserId: th.userId, text: text, replyTo: replyTo });
    inp.value = ""; clearReply();
  });
  $("#chatInput").addEventListener("input", function () {
    var now = Date.now(); if (now - lastTyping < 1500) return; lastTyping = now;
    var th = threads[activeKey];
    socket.emit("typing", { scope: th.key === "public" ? "public" : "dm", toUserId: th.userId });
  });
  $("#emojiBtn").onclick = function () { var r = $("#emojiRow"); r.hidden = !r.hidden; };
  $$("#emojiRow button").forEach(function (b) { b.onclick = function () { var i = $("#chatInput"); i.value += b.dataset.e; i.focus(); }; });

  socket.on("chat-message", function (m) { pushMsg(m); });
  socket.on("private-message", function (m) { if (m.meetingCode === R.code) pushMsg(m); });
  socket.on("system-message", function (m) { pushMsg({ system: true, scope: "public", text: m.text, time: m.time, from: { userId: "" } }, true); });
  socket.on("chat-blocked", function (d) { toast(d.message, "error"); });
  socket.on("dm-failed", function (d) { toast(d.message, "error"); });
  socket.on("typing", function (d) {
    var key = d.scope === "dm" ? "dm:" + d.userId : "public";
    if (key !== activeKey) return;
    $("#typing").textContent = d.name + " is typing…";
    clearTimeout(typingT); typingT = setTimeout(function () { $("#typing").textContent = ""; }, 2500);
  });
  socket.on("announcement", function (d) {
    var b = $("#annBanner"); b.hidden = false; b.innerHTML = "";
    b.appendChild(el("span", "", "📢"));
    var c = el("div"); c.style.flex = "1";
    c.appendChild(el("b", "", "Announcement from " + d.from)); c.appendChild(el("div", "", d.message));
    var x = el("button", "mini", "✕"); x.onclick = function () { b.hidden = true; };
    b.appendChild(c); b.appendChild(x);
    setTimeout(function () { b.hidden = true; }, 15000);
    pushMsg({ system: true, announce: true, scope: "public", text: d.from + ": " + d.message, time: d.time, from: { userId: "" } }, true);
  });

  function openDM(userId, name) {
    dmThread(userId, name); switchThread("dm:" + userId); switchTab("chat");
    if (isMobile()) $("#panel").classList.add("open");
  }

  /* =============== people =============== */
  function mini(icon, title, fn, bad) {
    var b = el("button", "mini" + (bad ? " bad" : "")); b.type = "button"; b.title = title;
    b.innerHTML = '<i data-lucide="' + icon + '"></i>'; b.onclick = fn; return b;
  }
  function renderPeople() {
    var box = $("#peopleList"); box.innerHTML = "";
    var arr = Object.keys(people).map(function (k) { return people[k]; });
    arr.sort(function (a, b) { return (b.isHost - a.isHost) || (b.handRaised - a.handRaised) || a.name.localeCompare(b.name); });
    arr.forEach(function (u) {
      var self = u.socketId === selfId, row = el("div", "prow");
      var av = el("span", "avatar", initials(u.name)); av.style.cssText = "width:36px;height:36px;border-radius:12px";
      var info = el("div", "info"), nm = el("b", "", u.name + (self ? " (You)" : ""));
      if (u.isHost) nm.appendChild(el("span", "badge b-accent", "Teacher"));
      if (u.handRaised) nm.appendChild(el("span", "", "✋"));
      info.appendChild(nm);
      info.appendChild(el("span", "muted small", (u.mic ? "🎤 on" : "🔇 muted") + " · " + (u.cam ? "📹 on" : "📷 off")));
      var acts = el("div", "acts");
      if (!self && (R.isHost || u.userId === R.hostId)) acts.appendChild(mini("message-square", "Message privately", function () { openDM(u.userId, u.name); }));
      if (R.isHost && !self) {
        acts.appendChild(mini("mic-off", "Mute", function () { socket.emit("host-mute-participant", { targetSocketId: u.socketId }); }));
        acts.appendChild(mini("video-off", "Turn off camera", function () { socket.emit("host-disable-camera", { targetSocketId: u.socketId }); }));
        acts.appendChild(mini("user-x", "Remove from class", function () { if (confirm("Remove " + u.name + " from the class?")) socket.emit("host-remove-participant", { targetSocketId: u.socketId }); }, true));
      }
      row.appendChild(av); row.appendChild(info); row.appendChild(acts); box.appendChild(row);
    });
    icons();
  }

  var lastWait = 0;
  socket.on("waiting-room-update", function (list) {
    var box = $("#waitBox"); if (!R.isHost && !box) return;
    box.innerHTML = ""; box.hidden = !list.length;
    setBadge("people", list.length, list.length);
    if (list.length > lastWait) toast("🚪 " + list[list.length - 1].name + " is waiting to join");
    lastWait = list.length;
    if (!list.length) return;
    box.appendChild(el("div", "sec-t", "Waiting room · " + list.length));
    list.forEach(function (u) {
      var r = el("div", "row between"); r.style.marginTop = "6px";
      r.appendChild(el("b", "", u.name));
      var a = el("div", "row gap-s");
      var ad = el("button", "btn btn-primary btn-sm", "Admit"); ad.onclick = function () { socket.emit("admit-participant", { targetSocketId: u.socketId }); };
      var dn = el("button", "btn btn-danger btn-sm", "Deny"); dn.onclick = function () { socket.emit("deny-participant", { targetSocketId: u.socketId }); };
      a.appendChild(ad); a.appendChild(dn); r.appendChild(a); box.appendChild(r);
    });
  });

  /* =============== live questions =============== */
  var questions = {}, modalQ = null;
  socket.on("new-question", function (q) {
    questions[q.questionId] = { id: q.questionId, text: q.questionText, options: q.options, responses: [], answered: null, isCorrect: null, correctAnswer: null };
    renderQuestions();
    if (!R.isHost) { openQuestionModal(q.questionId); }
    if (tabNow !== "qa") setBadge("qa", 1, 1);
  });
  function openQuestionModal(id) {
    var q = questions[id]; modalQ = id;
    $("#qmText").textContent = q.text; $("#qmFeed").textContent = "";
    var box = $("#qmOpts"); box.innerHTML = "";
    q.options.forEach(function (o) {
      var b = el("button", "qopt", o); b.type = "button";
      b.onclick = function () { answerQ(id, o); };
      box.appendChild(b);
    });
    $("#qModal").classList.add("open");
  }
  function answerQ(id, opt) {
    socket.emit("participant-answer", { questionId: id, answer: opt });
    $$("#qmOpts .qopt").forEach(function (b) { b.disabled = true; if (b.textContent === opt) b.classList.add("sel"); });
  }
  $("#qmClose").onclick = function () { $("#qModal").classList.remove("open"); };
  socket.on("answer-saved", function (d) {
    var q = questions[d.questionId]; if (!q) return;
    if (d.duplicate) return toast("You already answered this question", "error");
    q.answered = d.answer; q.isCorrect = d.isCorrect; q.correctAnswer = d.correctAnswer;
    if (modalQ === d.questionId) {
      $$("#qmOpts .qopt").forEach(function (b) {
        if (d.correctAnswer && b.textContent === d.correctAnswer) b.classList.add("ok");
        else if (b.classList.contains("sel") && d.isCorrect === false) b.classList.add("no");
      });
      $("#qmFeed").textContent = d.isCorrect === true ? "✅ Correct!" : d.isCorrect === false ? "❌ Not quite — correct answer: " + d.correctAnswer : "Answer submitted ✔";
      setTimeout(function () { if (modalQ === d.questionId) $("#qModal").classList.remove("open"); }, 2600);
    }
    renderQuestions();
  });
  socket.on("question-results-update", function (d) {
    if (questions[d.questionId]) { questions[d.questionId].responses = d.responses; renderQuestions(); }
  });
  function studentCount() { return Object.keys(people).filter(function (k) { return !people[k].isHost; }).length; }
  function renderQuestions() {
    var box = $("#qList"); box.innerHTML = "";
    var ids = Object.keys(questions).reverse();
    if (!ids.length) { box.appendChild(el("div", "empty-s", R.isHost ? "Questions you send will show live results here." : "Questions from your teacher appear here.")); return; }
    ids.forEach(function (id) {
      var q = questions[id], card = el("div", "qcard");
      card.appendChild(el("b", "", q.text));
      if (R.isHost) {
        var total = Math.max(1, studentCount());
        q.options.forEach(function (o) {
          var c = q.responses.filter(function (r) { return r.answer === o; }).length, pct = Math.round(c / total * 100);
          var row = el("div", "bar-r"), lab = el("div", "lab");
          lab.appendChild(el("span", "", o)); lab.appendChild(el("b", "", c + " · " + pct + "%"));
          var p = el("div", "progress"), i = el("i"); i.style.width = pct + "%"; p.appendChild(i);
          row.appendChild(lab); row.appendChild(p); card.appendChild(row);
        });
        card.appendChild(el("div", "muted small mt-s", q.responses.length + " of " + studentCount() + " students answered"));
      } else {
        q.options.forEach(function (o) {
          var b = el("button", "qopt", o); b.type = "button"; b.disabled = !!q.answered;
          if (q.answered === o) b.classList.add(q.isCorrect === true ? "ok" : q.isCorrect === false ? "no" : "sel");
          if (q.answered && q.correctAnswer === o) b.classList.add("ok");
          b.onclick = function () { socket.emit("participant-answer", { questionId: id, answer: o }); };
          card.appendChild(b);
        });
      }
      box.appendChild(card);
    });
  }
  renderQuestions();

  if (R.isHost) {
    var syncQForm = function () {
      var tf = $("#qType").value === "tf", sel = $("#qCorrect");
      $("#qOpts").style.display = tf ? "none" : "";
      sel.innerHTML = '<option value="">Don\'t reveal</option>';
      var opts = tf ? ["True", "False"] : ["A", "B", "C", "D"];
      opts.forEach(function (l, i) { var o = el("option", "", tf ? l : "Option " + l); o.value = i; sel.appendChild(o); });
    };
    $("#qType").onchange = syncQForm; syncQForm();
    $("#qForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var tf = $("#qType").value === "tf";
      var opts = tf ? ["True", "False"] : $$(".q-opt").map(function (i) { return i.value.trim(); });
      if (opts.some(function (o) { return !o; })) return toast("Fill all 4 options", "error");
      var c = $("#qCorrect").value;
      socket.emit("host-send-question", { questionText: $("#qText").value.trim(), options: opts, correctIndex: c === "" ? null : Number(c) });
      $("#qForm").reset(); syncQForm(); toast("Question sent to the class ✔", "success");
    });
  }

  /* =============== materials =============== */
  function loadMaterials(hl) {
    fetch("/chapter/api/" + encodeURIComponent(R.code), { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        var box = $("#matList"); box.innerHTML = "";
        if (!list.length) { box.appendChild(el("div", "empty-s", "No materials yet.")); return; }
        list.forEach(function (c) {
          var card = el("div", "matcard" + (hl && hl === c._id ? " pulse" : ""));
          card.appendChild(el("b", "", c.title));
          if (c.explanation) card.appendChild(el("p", "muted small mt-s", c.explanation.slice(0, 220)));
          var links = el("div", "row wrap gap-s mt-s");
          function lk(label, url) { var a = el("a", "btn btn-soft btn-sm", label); a.href = safeUrl(url); a.target = "_blank"; a.rel = "noopener"; links.appendChild(a); }
          if (c.pdfFile) lk("📄 PDF", c.pdfFile);
          if (c.videoUrl) lk("▶️ Video", c.videoUrl);
          (c.images || []).forEach(function (u, i) { lk("🖼 Image " + (i + 1), u); });
          (c.links || []).forEach(function (l) { lk("🔗 " + (l.title || "Link"), l.url); });
          card.appendChild(links);
          if (c.notes || (c.codeExamples && c.codeExamples.length)) {
            var d = el("details", "mt-s"), s = el("summary", "link", "Notes & code"); s.style.cursor = "pointer"; d.appendChild(s);
            if (c.notes) d.appendChild(el("p", "muted small mt-s", c.notes));
            (c.codeExamples || []).forEach(function (ex) { d.appendChild(el("pre", "code mt-s", ex.code || "")); });
            card.appendChild(d);
          }
          if (R.isHost) {
            var sh = el("button", "btn btn-primary btn-sm mt-s", "Share with class"); sh.type = "button";
            sh.onclick = function () { socket.emit("share-chapter", { chapterId: c._id }); toast("Shared with the class ✔", "success"); };
            card.appendChild(sh);
          }
          box.appendChild(card);
        });
      }).catch(function () {});
  }
  socket.on("chapter-shared", function (d) {
    toast("📚 New material: " + d.title, "", 6000);
    if (tabNow !== "material") setBadge("material", 1, 1);
    loadMaterials(d.chapterId);
  });
  loadMaterials();

  /* =============== tabs / panel =============== */
  function switchTab(name) {
    tabNow = name;
    $$(".tabs-r [data-tab]").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === name); });
    $$(".pane").forEach(function (p) { p.classList.toggle("on", p.id === "pane-" + name); });
    if (name === "chat") { threads[activeKey].unread = 0; renderThreads(); renderMsgs(); }
    if (name === "qa") setBadge("qa", 0, 0);
    if (name === "material") setBadge("material", 0, 0);
    updateBadges();
  }
  $$(".tabs-r [data-tab]").forEach(function (b) { b.onclick = function () { switchTab(b.dataset.tab); }; });
  $("#panelOpen").onclick = function () { $("#panel").classList.add("open"); switchTab(tabNow); };
  $("#panelClose").onclick = function () { $("#panel").classList.remove("open"); };

  /* =============== reactions =============== */
  $("#reactBtn").onclick = function (e) { e.stopPropagation(); var p = $("#reactPop"); p.hidden = !p.hidden; };
  $$("#reactPop button").forEach(function (b) { b.onclick = function () { socket.emit("send-reaction", { emoji: b.dataset.e }); $("#reactPop").hidden = true; }; });
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#reactPop") && !e.target.closest("#reactBtn")) $("#reactPop").hidden = true;
    if (R.isHost && !e.target.closest("#ctrlPop") && !e.target.closest("#ctrlBtn")) $("#ctrlPop").hidden = true;
  });
  socket.on("reaction-received", function (d) {
    var f = el("div", "fl", d.emoji); f.style.left = (8 + Math.random() * 84) + "%";
    $("#reactions").appendChild(f); setTimeout(function () { f.remove(); }, 2900);
  });

  /* =============== whiteboard =============== */
  var cv = $("#bcanvas"), cx = cv.getContext("2d"), BG = "#0c1228";
  var pen = { c: "#5eead4", w: 4 }, drawing = false, last = null;
  function clearBoard() { cx.fillStyle = BG; cx.fillRect(0, 0, cv.width, cv.height); }
  clearBoard();
  function seg(a, b, c, w) {
    cx.strokeStyle = c; cx.lineWidth = w; cx.lineCap = "round"; cx.lineJoin = "round";
    cx.beginPath(); cx.moveTo(a.x * cv.width, a.y * cv.height); cx.lineTo(b.x * cv.width, b.y * cv.height); cx.stroke();
  }
  function pt(e) { var r = cv.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; }
  function boardOpen(open) { $("#board").hidden = !open; $("#boardBtn").classList.toggle("on", open); }
  socket.on("wb-visibility", function (d) { boardOpen(d.open); });
  socket.on("wb-draw", function (d) { seg(d.a, d.b, d.c, d.w); });
  socket.on("wb-clear", clearBoard);

  if (R.isHost) {
    $("#boardBtn").onclick = function () { var open = $("#board").hidden; boardOpen(open); socket.emit("wb-visibility", { open: open }); };
    cv.addEventListener("pointerdown", function (e) {
      drawing = true; last = pt(e); cv.setPointerCapture(e.pointerId);
      var p = { x: last.x + 0.0002, y: last.y }; seg(last, p, pen.c, pen.w); socket.emit("wb-draw", { a: last, b: p, c: pen.c, w: pen.w });
    });
    cv.addEventListener("pointermove", function (e) {
      if (!drawing) return; var p = pt(e); seg(last, p, pen.c, pen.w); socket.emit("wb-draw", { a: last, b: p, c: pen.c, w: pen.w }); last = p;
    });
    cv.addEventListener("pointerup", function () { drawing = false; });
    $$(".swatch").forEach(function (s) { s.onclick = function () { $$(".swatch").forEach(function (x) { x.classList.remove("on"); }); s.classList.add("on"); pen = { c: s.dataset.c, w: 4 }; }; });
    $("#eraser").onclick = function () { pen = { c: BG, w: 26 }; $$(".swatch").forEach(function (x) { x.classList.remove("on"); }); };
    $("#bclear").onclick = function () { clearBoard(); socket.emit("wb-clear"); };
  } else {
    $("#boardBtn").onclick = function () { var b = $("#board"); b.hidden = !b.hidden; $("#boardBtn").classList.toggle("on", !b.hidden); };
    cv.style.pointerEvents = "none";
  }

  /* =============== host-only controls =============== */
  if (R.isHost) {
    $("#ctrlBtn").onclick = function (e) { e.stopPropagation(); var p = $("#ctrlPop"); p.hidden = !p.hidden; };
    $("#swChat").onchange = function () { socket.emit("host-toggle-chat", { allowed: this.checked }); };
    $("#swShare").onchange = function () { socket.emit("host-toggle-screenshare", { allowed: this.checked }); };
    $("#swLock").checked = R.perms.locked;
    $("#swLock").onchange = function () { socket.emit("host-toggle-lock", { isLocked: this.checked }); toast(this.checked ? "Meeting locked — no new joins" : "Meeting unlocked", "success"); };
    $("#swWait").checked = R.perms.waiting;
    $("#swWait").onchange = function () {
      var box = this;
      fetch("/invite/" + encodeURIComponent(R.code) + "/toggle-waiting-room", { method: "POST", credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (d) { box.checked = !!d.waitingRoomEnabled; toast(d.waitingRoomEnabled ? "Waiting room on" : "Waiting room off", "success"); })
        .catch(function () { box.checked = !box.checked; toast("Could not change waiting room", "error"); });
    };

    $("#endBtn").onclick = function () { if (confirm("End this class for everyone?")) socket.emit("host-end-meeting"); };

    $("#annBtn").onclick = function () { $("#annModal").classList.add("open"); $("#annText").focus(); };
    $("#annCancel").onclick = function () { $("#annModal").classList.remove("open"); };
    $("#annSend").onclick = function () {
      var m = $("#annText").value.trim(); if (!m) return;
      socket.emit("host-announcement", { message: m }); $("#annText").value = ""; $("#annModal").classList.remove("open");
    };

    /* real recording of this tab → downloads a .webm when you stop */
    var rec = null, chunks = [];
    var setRec = function (on) { $("#recBtn").classList.toggle("off", on); setIcon($("#recBtn"), on ? "square" : "circle-dot"); };
    $("#recBtn").onclick = function () {
      if (rec) { rec.stop(); return; }
      if (!window.MediaRecorder) return toast("Recording is not supported in this browser", "error");
      navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, preferCurrentTab: true }).then(function (s) {
        chunks = [];
        var mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
        rec = new MediaRecorder(s, { mimeType: mime });
        rec.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
        rec.onstop = function () {
          s.getTracks().forEach(function (t) { t.stop(); });
          var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
          a.download = R.code + "-recording.webm"; a.click();
          rec = null; setRec(false); socket.emit("recording-status", { isRecording: false });
          toast("Recording saved to your downloads", "success");
        };
        s.getVideoTracks()[0].onended = function () { if (rec && rec.state !== "inactive") rec.stop(); };
        rec.start(1000); setRec(true); socket.emit("recording-status", { isRecording: true });
        toast("Recording — choose “This tab” and tick “Share tab audio”");
      }).catch(function () { toast("Recording cancelled", "error"); });
    };
  }
  socket.on("recording-status", function (d) { $("#recBadge").hidden = !d.isRecording; });

  /* =============== misc =============== */
  $("#copyBtn").onclick = function () {
    var link = location.origin + "/meeting/" + R.code;
    function ok() { toast("Invite link copied", "success", 2200); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(link).then(ok);
    else { var t = document.createElement("textarea"); t.value = link; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e) {} t.remove(); ok(); }
  };
  $("#leaveBtn").onclick = function () {
    if (!confirm("Leave this class?")) return;
    socket.emit("leave-room");
    if (localStream) localStream.getTracks().forEach(function (t) { t.stop(); });
    location.href = R.home;
  };

  var t0 = R.startedAt ? new Date(R.startedAt).getTime() : Date.now();
  setInterval(function () {
    var s = Math.max(0, Math.floor((Date.now() - t0) / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    $("#timer").textContent = (h ? h + ":" : "") + String(m).padStart(h ? 2 : 1, "0") + ":" + String(x).padStart(2, "0");
  }, 1000);

  renderThreads(); updateComposer(); updateBadges(); icons();
  initMedia();
})();