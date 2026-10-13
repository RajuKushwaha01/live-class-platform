const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const User = require("../models/User");
const sendEmail = require("../utils/sendEmail");

const PORTALS = {
  student: { role: "participant", label: "Student" },
  teacher: { role: "host", label: "Teacher" },
  admin: { role: "admin", label: "Admin" },
};
const getPortal = (p) => (PORTALS[p] ? p : "student");
const homeFor = (role) =>
  role === "admin" ? "/admin/dashboard" : role === "host" ? "/host/dashboard" : "/participant/dashboard";


// ---- brute-force protection: 5 wrong passwords → 10 minute lock ----
const attempts = new Map();
const MAX_TRIES = 5, LOCK_MS = 10 * 60 * 1000;
const isLocked = (k) => { const a = attempts.get(k); return !!(a && a.until > Date.now()); };
function recordFail(k) {
  const a = attempts.get(k) || { n: 0, until: 0 };
  if (a.until && a.until < Date.now()) { a.n = 0; a.until = 0; }
  a.n++;
  if (a.n >= MAX_TRIES) a.until = Date.now() + LOCK_MS;
  attempts.set(k, a);
}

function startSession(req, res, user) {
  req.session.regenerate((err) => {
    if (err) return res.status(500).send("Session error");
    req.session.user = { _id: user._id, name: user.name, email: user.email, role: user.role };
    req.session.save(() => res.redirect(homeFor(user.role)));
  });
}

// ---------- REGISTER ----------
router.get("/register", (req, res) => {
  if (req.session.user) return res.redirect(homeFor(req.session.user.role));
  let portal = getPortal(req.query.portal);
  if (portal === "admin") portal = "student";
  res.render("auth/register", { portal, error: null, needsCode: !!process.env.TEACHER_SIGNUP_CODE });
});

router.post("/register", async (req, res) => {
  let portal = getPortal(req.body.portal);
  if (portal === "admin") portal = "student";
  const needsCode = !!process.env.TEACHER_SIGNUP_CODE;
  const fail = (msg) => res.render("auth/register", { portal, error: msg, needsCode });

  try {
    const { name, password, teacherCode } = req.body;
    const email = (req.body.email || "").trim().toLowerCase();

    if (!name || !email || !password || password.length < 6)
      return fail("Please fill every field. Password must be at least 6 characters.");
    if (portal === "teacher" && needsCode && teacherCode !== process.env.TEACHER_SIGNUP_CODE)
      return fail("Invalid teacher access code.");
    if (await User.findOne({ email })) return fail("This email is already registered.");

    const user = await User.create({ name: name.trim(), email, password, role: PORTALS[portal].role });
    startSession(req, res, user);
  } catch (err) {
    console.error(err);
    fail("Something went wrong. Please try again.");
  }
});

// ---------- LOGIN ----------
router.get("/login", (req, res) => {
  if (req.session.user) return res.redirect(homeFor(req.session.user.role));
  res.render("auth/login", { portal: getPortal(req.query.portal), error: null, blocked: req.query.blocked || false });
});

router.post("/login", async (req, res) => {
  const portal = getPortal(req.body.portal);
  const fail = (msg) => res.render("auth/login", { portal, error: msg, blocked: false });

  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const key = email + "|" + req.ip;

    if (isLocked(key)) return fail("Too many failed attempts. Please try again in 10 minutes.");

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(req.body.password || ""))) {
      recordFail(key);
      return fail("Invalid email or password.");
    }
    if (user.isBlocked) return fail("Your account has been blocked by the admin.");

    if (user.role !== PORTALS[portal].role) {
      const actual = Object.keys(PORTALS).find((k) => PORTALS[k].role === user.role);
      return fail(`This is a ${PORTALS[actual].label} account. Please use the ${PORTALS[actual].label} tab.`);
    }

    attempts.delete(key);
    startSession(req, res, user);
  } catch (err) {
    console.error(err);
    fail("Something went wrong. Please try again.");
  }
});

// ---------- FORGOT PASSWORD ----------
router.get("/forgot-password", (req, res) => {
  res.render("auth/forgot-password", { message: null, error: null });
});

router.post("/forgot-password", async (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user) {
      return res.render("auth/forgot-password", { error: "No account found with that email.", message: null });
    }

    const token = crypto.randomBytes(20).toString("hex");
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    const base = process.env.CLIENT_URL || `${req.protocol}://${req.get("host")}`;
    const resetLink = `${base}/auth/reset-password/${token}`;

    await sendEmail({
      to: user.email,
      subject: "Password Reset — EduLive",
      html: `<p>Hello ${user.name},</p><p>Click below to reset your password (valid 1 hour):</p><a href="${resetLink}">${resetLink}</a>`,
    });

    res.render("auth/forgot-password", { message: "Reset link sent to your email.", error: null });
  } catch (err) {
    console.error(err);
    res.render("auth/forgot-password", { error: "Something went wrong.", message: null });
  }
});

// ---------- RESET PASSWORD ----------
router.get("/reset-password/:token", async (req, res) => {
  const user = await User.findOne({
    resetPasswordToken: req.params.token,
    resetPasswordExpires: { $gt: Date.now() },
  });
  if (!user) return res.send("Reset link is invalid or has expired.");
  res.render("auth/reset-password", { token: req.params.token, error: null });
});

router.post("/reset-password/:token", async (req, res) => {
  const user = await User.findOne({
    resetPasswordToken: req.params.token,
    resetPasswordExpires: { $gt: Date.now() },
  });
  if (!user) return res.send("Reset link is invalid or has expired.");

  user.password = req.body.password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();
  res.redirect("/auth/login");
});

// ---------- LOGOUT ----------
router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

module.exports = router;