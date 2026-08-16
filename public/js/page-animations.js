document.addEventListener("DOMContentLoaded", () => {
  if (typeof gsap === "undefined") return;

  // Hero entrance
  const heroTl = gsap.timeline({ defaults: { ease: "power3.out" } });
  heroTl
    .from(".hero-badge", { opacity: 0, y: -20, duration: 0.6 })
    .from(".hero-title span", { opacity: 0, y: 40, stagger: 0.08, duration: 0.8 }, "-=0.3")
    .from(".hero-subtitle", { opacity: 0, y: 20, duration: 0.7 }, "-=0.4")
    .from(".hero-buttons", { opacity: 0, y: 20, duration: 0.6 }, "-=0.4")
    .from(".hero-visual", { opacity: 0, scale: 0.9, duration: 0.9 }, "-=0.6");

  // Navbar fade in
  gsap.from("nav", { opacity: 0, y: -30, duration: 0.7, ease: "power2.out" });

  // Feature cards scroll reveal
  if (typeof ScrollTrigger !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
    gsap.utils.toArray(".feature-card").forEach((card, i) => {
      gsap.from(card, {
        scrollTrigger: { trigger: card, start: "top 85%" },
        opacity: 0,
        y: 50,
        duration: 0.6,
        delay: i * 0.08,
        ease: "power2.out",
      });
    });

    gsap.utils.toArray(".reveal-section").forEach((sec) => {
      gsap.from(sec, {
        scrollTrigger: { trigger: sec, start: "top 80%" },
        opacity: 0,
        y: 40,
        duration: 0.7,
      });
    });
  }

  // Dashboard stat count-up
  document.querySelectorAll(".count-up").forEach((el) => {
    const target = parseInt(el.dataset.target || el.textContent, 10);
    gsap.fromTo(
      el,
      { textContent: 0 },
      {
        textContent: target,
        duration: 1.4,
        ease: "power1.out",
        snap: { textContent: 1 },
        onUpdate: function () {
          el.textContent = Math.floor(el.textContent);
        },
      }
    );
  });
});