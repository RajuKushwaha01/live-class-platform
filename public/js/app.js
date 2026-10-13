(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var icons = function () { if (window.lucide) window.lucide.createIcons(); };
  var body = document.body;

  /* ---- theme toggle ---- */
  var tt = $("#themeToggle");
  if (tt) tt.addEventListener("click", function () {
    var h = document.documentElement, n = h.dataset.theme === "dark" ? "light" : "dark";
    h.dataset.theme = n;
    try { localStorage.setItem("theme", n); } catch (e) {}
  });

  /* ---- mobile drawer ---- */
  var mb = $("#menuBtn"), ov = $("#overlay");
  if (mb) mb.addEventListener("click", function () { body.classList.toggle("nav-open"); });
  if (ov) ov.addEventListener("click", function () { body.classList.remove("nav-open"); });

  /* ---- dropdowns ---- */
  $$("[data-dd]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var dd = btn.closest(".dd"), was = dd.classList.contains("open");
      $$(".dd.open").forEach(function (d) { d.classList.remove("open"); });
      if (!was) dd.classList.add("open");
    });
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".dd-menu")) $$(".dd.open").forEach(function (d) { d.classList.remove("open"); });
  });

  /* ---- toast ---- */
  window.toast = function (msg, type, ms, href) {
    var box = $("#toasts"); if (!box) return;
    var t = document.createElement(href ? "a" : "div");
    t.className = "toast " + (type || "info");
    if (href) t.href = href;
    t.textContent = msg;
    box.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("in"); });
    setTimeout(function () { t.classList.remove("in"); setTimeout(function () { t.remove(); }, 300); }, ms || 4500);
  };

  /* ---- command palette ---- */
  var pal = $("#palette"), pin = $("#palInput"), plist = $("#palList");
  var cmds = window.__CMD || [];
  function renderPal(q) {
    q = (q || "").toLowerCase().trim();
    var res = cmds.filter(function (c) { return c.label.toLowerCase().indexOf(q) > -1; });
    if (/^[a-z0-9_-]{6,12}$/i.test(q) && window.__ROLE === "participant")
      res.unshift({ label: "Join meeting " + q.toUpperCase(), href: "/meeting/" + encodeURIComponent(q.toUpperCase()), icon: "log-in", group: "Join" });
    plist.innerHTML = "";
    if (!res.length) { plist.innerHTML = '<div class="empty-s">No results</div>'; return; }
    res.forEach(function (c, i) {
      var a = document.createElement("a");
      a.href = c.href; a.className = "pal-item" + (i === 0 ? " sel" : "");
      a.innerHTML = '<i data-lucide="' + c.icon + '"></i><span></span><em></em>';
      a.children[1].textContent = c.label; a.children[2].textContent = c.group || "";
      plist.appendChild(a);
    });
    icons();
  }
  function openPal() { if (!pal) return; pal.classList.add("open"); pin.value = ""; renderPal(""); setTimeout(function () { pin.focus(); }, 30); }
  function closePal() { if (pal) pal.classList.remove("open"); }
  var po = $("#palOpen"); if (po) po.addEventListener("click", openPal);
  if (pal) pal.addEventListener("click", function (e) { if (e.target === pal) closePal(); });
  if (pin) {
    pin.addEventListener("input", function () { renderPal(pin.value); });
    pin.addEventListener("keydown", function (e) {
      var items = $$(".pal-item", plist), cur = items.findIndex(function (i) { return i.classList.contains("sel"); });
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!items.length) return;
        items[cur] && items[cur].classList.remove("sel");
        cur = e.key === "ArrowDown" ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
        items[cur].classList.add("sel"); items[cur].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (items[cur]) window.location.href = items[cur].getAttribute("href");
      }
    });
  }
  document.addEventListener("keydown", function (e) {
    var typing = /input|textarea|select/i.test((e.target.tagName || ""));
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPal(); }
    else if (e.key === "/" && !typing) { e.preventDefault(); openPal(); }
    else if (e.key === "Escape") { closePal(); body.classList.remove("nav-open"); }
  });

  /* ---- notifications ---- */
  function ago(d) {
    var s = Math.floor((Date.now() - new Date(d)) / 1000);
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago"; return Math.floor(s / 86400) + "d ago";
  }
  function loadNotifs() {
    var list = $("#notifList"); if (!list) return;
    fetch("/notification/api/list", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      var dot = $("#bellDot"); dot.hidden = !d.unreadCount; dot.textContent = d.unreadCount > 9 ? "9+" : d.unreadCount;
      list.innerHTML = "";
      if (!d.notifications.length) { list.innerHTML = '<div class="empty-s">You are all caught up 🎉</div>'; return; }
      d.notifications.forEach(function (n) {
        var a = document.createElement("a");
        a.className = "notif-item" + (n.isRead ? "" : " unread"); a.href = n.link || "#";
        var t = document.createElement("b"); t.textContent = n.title || "";
        var m = document.createElement("span"); m.textContent = n.message || "";
        var w = document.createElement("em"); w.textContent = ago(n.createdAt);
        a.appendChild(t); a.appendChild(m); a.appendChild(w);
        a.addEventListener("click", function () { fetch("/notification/" + n._id + "/read", { method: "POST", credentials: "same-origin", keepalive: true }); });
        list.appendChild(a);
      });
    }).catch(function () {});
  }
  var ma = $("#markAll");
  if (ma) ma.addEventListener("click", function (e) {
    e.stopPropagation();
    fetch("/notification/read-all", { method: "POST", credentials: "same-origin" }).then(loadNotifs);
  });
  loadNotifs();

  /* ---- live banner + realtime socket ---- */
  function liveBanner(d) {
    var old = $("#liveBanner"); if (old) old.remove();
    var b = document.createElement("div"); b.id = "liveBanner"; b.className = "live-banner";
    b.innerHTML = '<span class="live-dot"></span><div class="grow"><b></b><small></small></div><a class="btn btn-primary btn-sm">Join now</a><button class="icon-btn" aria-label="Dismiss" style="width:34px;height:34px">✕</button>';
    b.querySelector("b").textContent = (d.meetingTitle || "Class") + " is live!";
    b.querySelector("small").textContent = (d.hostName || "Your teacher") + " just started the class";
    b.querySelector("a").href = d.link || "#";
    b.querySelector("button").addEventListener("click", function () { b.remove(); });
    document.body.appendChild(b);
    setTimeout(function () { b.remove(); }, 30000);
  }
  if (window.io) {
    var uid = body.dataset.uid, s = window.io();
    window.globalSocket = s;
    s.on("connect", function () { if (uid) s.emit("register-user", { userId: uid }); });
    s.on("new-notification", function (n) { toast((n.title || "Notification") + " — " + (n.message || ""), "info", 6500, n.link); loadNotifs(); });
    s.on("new-submission", function (d) { toast(d.participantName + " submitted “" + d.assignmentTitle + "”", "success", 6500, "/assignment/grade/" + d.assignmentId); loadNotifs(); });
    s.on("meeting-live", liveBanner);
  }

  /* ---- count-up + reveal ---- */
  function countUp(el) {
    var target = Number(el.dataset.count) || 0, start = performance.now(), dur = 1000;
    (function tick(now) {
      var p = Math.min((now - start) / dur, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    })(start);
  }
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        $$("[data-count]", e.target).forEach(countUp);
        if (e.target.hasAttribute("data-count")) countUp(e.target);
        io.unobserve(e.target);
      });
    }, { threshold: 0.1 });
    $$(".reveal").forEach(function (el) { io.observe(el); });
    $$("[data-count]").forEach(function (el) { if (!el.closest(".reveal")) io.observe(el); });
  } else {
    $$(".reveal").forEach(function (el) { el.classList.add("in"); });
    $$("[data-count]").forEach(function (el) { el.textContent = el.dataset.count; });
  }

  /* ---- search + tab filters ---- */
  $$("[data-list]").forEach(function (list) {
    var id = "#" + list.id, search = $('[data-search-for="' + id + '"]'),
      tabs = $$('[data-filter-for="' + id + '"] [data-f]'), empty = $('[data-empty-for="' + id + '"]');
    var f = "all", q = "";
    function apply() {
      var n = 0;
      $$("[data-item]", list).forEach(function (it) {
        var okF = f === "all" || (it.dataset.status || "").split(" ").indexOf(f) > -1;
        var okQ = !q || it.textContent.toLowerCase().indexOf(q) > -1;
        it.hidden = !(okF && okQ); if (!it.hidden) n++;
      });
      if (empty) empty.hidden = n > 0;
    }
    if (search) search.addEventListener("input", function () { q = search.value.trim().toLowerCase(); apply(); });
    tabs.forEach(function (b) {
      b.addEventListener("click", function () { tabs.forEach(function (x) { x.classList.remove("on"); }); b.classList.add("on"); f = b.dataset.f; apply(); });
    });
    apply();
  });

  /* ---- copy buttons + confirm forms ---- */
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-copy]"); if (!b) return;
    e.preventDefault();
    var v = b.getAttribute("data-copy"); if (v.charAt(0) === "/") v = location.origin + v;
    function done() { toast("Copied to clipboard", "success", 2200); }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(v).then(done);
    else { var t = document.createElement("textarea"); t.value = v; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (x) {} t.remove(); done(); }
  });
  document.addEventListener("submit", function (e) {
    var m = e.target.getAttribute("data-confirm"); if (m && !window.confirm(m)) e.preventDefault();
  });

  /* ---- live elapsed timers ---- */
  var timers = $$("[data-since]");
  function tickTimers() {
    timers.forEach(function (el) {
      var s = Math.max(0, Math.floor((Date.now() - new Date(el.dataset.since)) / 1000));
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
      el.textContent = (h ? h + ":" : "") + String(m).padStart(h ? 2 : 1, "0") + ":" + String(x).padStart(2, "0");
    });
  }
  if (timers.length) { tickTimers(); setInterval(tickTimers, 1000); }

  icons();
})();