const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const User = require("../models/User");
const sendEmail = require("../utils/sendEmail");

// GET Register Page
router.get("/register", (req, res) => {
  res.render("auth/register", { error: null });
});

// POST Register
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.render("auth/register", { error: "Email already registered." });
    }

    const allowedRole = role === "host" ? "host" : "participant";

    const user = await User.create({ name, email, password, role: allowedRole });

    req.session.user = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    if (user.role === "host") return res.redirect("/host/dashboard");
    return res.redirect("/participant/dashboard");
  } catch (err) {
    console.error(err);
    res.render("auth/register", { error: "Something went wrong. Try again." });
  }
});

// GET Login Page
router.get("/login", (req, res) => {
  res.render("auth/login", { error: null, blocked: req.query.blocked || false });
});

// POST Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.render("auth/login", { error: "Invalid email or password.", blocked: false });
    }

    if (user.isBlocked) {
      return res.render("auth/login", {
        error: "Your account has been blocked by the admin.",
        blocked: false,
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.render("auth/login", { error: "Invalid email or password.", blocked: false });
    }

    req.session.user = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    if (user.role === "admin") return res.redirect("/admin/dashboard");
    if (user.role === "host") return res.redirect("/host/dashboard");
    return res.redirect("/participant/dashboard");
  } catch (err) {
    console.error(err);
    res.render("auth/login", { error: "Something went wrong.", blocked: false });
  }
});

// GET Forgot Password
router.get("/forgot-password", (req, res) => {
  res.render("auth/forgot-password", { message: null, error: null });
});

// POST Forgot Password
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.render("auth/forgot-password", {
        error: "No account found with that email.",
        message: null,
      });
    }

    const token = crypto.randomBytes(20).toString("hex");
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    const resetLink = `${process.env.CLIENT_URL}/auth/reset-password/${token}`;

    await sendEmail({
      to: user.email,
      subject: "Password Reset — Live Class Platform",
      html: `<p>Hello ${user.name},</p><p>Click below to reset your password (valid 1 hour):</p><a href="${resetLink}">${resetLink}</a>`,
    });

    res.render("auth/forgot-password", {
      message: "Reset link sent to your email.",
      error: null,
    });
  } catch (err) {
    console.error(err);
    res.render("auth/forgot-password", { error: "Something went wrong.", message: null });
  }
});

// GET Reset Password
router.get("/reset-password/:token", async (req, res) => {
  const user = await User.findOne({
    resetPasswordToken: req.params.token,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    return res.send("Reset link is invalid or has expired.");
  }

  res.render("auth/reset-password", { token: req.params.token, error: null });
});

// POST Reset Password
router.post("/reset-password/:token", async (req, res) => {
  const user = await User.findOne({
    resetPasswordToken: req.params.token,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) {
    return res.send("Reset link is invalid or has expired.");
  }

  user.password = req.body.password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  res.redirect("/auth/login");
});

// Logout
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/auth/login");
  });
});

module.exports = router;