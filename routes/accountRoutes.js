const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { isAuthenticated } = require("../middleware/auth");

router.use(isAuthenticated);

async function render(req, res, message, error) {
  const profile = await User.findById(req.session.user._id).lean();
  if (!profile) return res.redirect("/auth/logout");
  res.render("shared/settings", {
    user: req.session.user,
    role: req.session.user.role,
    profile,
    message: message || null,
    error: error || null,
  });
}

router.get("/settings", (req, res) => render(req, res));

router.post("/profile", async (req, res) => {
  try {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    if (!name || !email) return render(req, res, null, "Name and email are required.");

    const clash = await User.findOne({ email, _id: { $ne: req.session.user._id } });
    if (clash) return render(req, res, null, "That email is already used by another account.");

    await User.findByIdAndUpdate(req.session.user._id, { name, email });
    req.session.user.name = name;
    req.session.user.email = email;
    req.session.save(() => render(req, res, "Profile updated.", null));
  } catch (e) {
    console.error(e);
    render(req, res, null, "Could not update profile.");
  }
});

router.post("/password", async (req, res) => {
  try {
    const { current, next, confirm } = req.body;
    if (!next || next.length < 6) return render(req, res, null, "New password must be at least 6 characters.");
    if (next !== confirm) return render(req, res, null, "New passwords do not match.");

    const doc = await User.findById(req.session.user._id);
    if (!doc || !(await doc.comparePassword(current || ""))) return render(req, res, null, "Current password is incorrect.");

    doc.password = next; // hashed by the pre-save hook
    await doc.save();
    render(req, res, "Password changed successfully.", null);
  } catch (e) {
    console.error(e);
    render(req, res, null, "Could not change password.");
  }
});

module.exports = router;