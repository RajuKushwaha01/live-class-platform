(function () {
  const d = document;
  const fine = matchMedia("(hover:hover) and (pointer:fine)").matches;

  if (window.lucide) lucide.createIcons();

  // Scroll reveal
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); revealIO.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  d.querySelectorAll("[data-reveal]").forEach((el) => {
    el.style.transitionDelay = (el.dataset.delay || 0) + "ms";
    revealIO.observe(el);
  });

  // Count-up numbers
  const countIO = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      countIO.unobserve(e.target);
      const target = Number(e.target.dataset.count) || 0;
      const start = performance.now(), dur = 1100;
      (function tick(now) {
        const p = Math.min((now - start) / dur, 1);
        e.target.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
      })(start);
    });
  });
  d.querySelectorAll("[data-count]").forEach((el) => countIO.observe(el));

  // Card spotlight + 3D tilt
  d.addEventListener("pointermove", (e) => {
    const c = e.target.closest && e.target.closest(".glass-card");
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty("--mx", e.clientX - r.left + "px");
    c.style.setProperty("--my", e.clientY - r.top + "px");
    if (fine && c.classList.contains("card-3d")) {
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      c.style.setProperty("--ry", x * 6 + "deg");
      c.style.setProperty("--rx", -y * 6 + "deg");
    }
  });
  d.addEventListener("pointerout", (e) => {
    const c = e.target.closest && e.target.closest(".card-3d");
    if (c && !c.contains(e.relatedTarget)) { c.style.setProperty("--rx", "0deg"); c.style.setProperty("--ry", "0deg"); }
  });

  // Soft cursor glow (desktop only)
  if (fine) {
    const g = d.createElement("div");
    g.className = "cursor-glow";
    d.body.appendChild(g);
    let tx = 0, ty = 0, x = 0, y = 0;
    addEventListener("pointermove", (e) => { tx = e.clientX; ty = e.clientY; });
    (function loop() {
      x += (tx - x) * 0.12; y += (ty - y) * 0.12;
      g.style.transform = `translate(${x - 200}px,${y - 200}px)`;
      requestAnimationFrame(loop);
    })();
  }

  // Button ripple
  d.addEventListener("click", (e) => {
    const b = e.target.closest(".btn-glow");
    if (!b) return;
    const r = b.getBoundingClientRect(), s = d.createElement("span");
    s.className = "ripple";
    s.style.left = e.clientX - r.left + "px";
    s.style.top = e.clientY - r.top + "px";
    b.appendChild(s);
    setTimeout(() => s.remove(), 600);
  });

  // Smooth page transitions
  d.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === "_blank" || a.hasAttribute("download")) return;
    const h = a.getAttribute("href");
    if (!h || h.startsWith("#") || h.startsWith("/#") || h.startsWith("mailto:") || h.startsWith("tel:")) return;
    if (/^https?:/.test(h) && !h.startsWith(location.origin)) return;
    e.preventDefault();
    d.body.classList.add("page-leave");
    setTimeout(() => (location.href = a.href), 200);
  });
  addEventListener("pageshow", () => d.body.classList.remove("page-leave"));

  // Password show/hide
  d.querySelectorAll("[data-toggle-pass]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = d.getElementById(btn.dataset.togglePass);
      input.type = input.type === "password" ? "text" : "password";
    });
  });
})();