const User = require("../models/User");

module.exports = async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role !== "admin") {
      existing.role = "admin";
      await existing.save();
      console.log(`🛡️  ${email} promoted to admin`);
    }
    return;
  }
  await User.create({ name: process.env.ADMIN_NAME || "Administrator", email, password, role: "admin" });
  console.log(`🛡️  Admin account created: ${email}`);
};