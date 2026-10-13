require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const email = (process.argv[2] || "adminraju@gmail.com").toLowerCase();
  const password = process.argv[3] || "Password@123";

  let user = await User.findOne({ email });
  if (user) {
    user.role = "admin";
    user.password = password;
    await user.save();
  } else {
    await User.create({ name: "Administrator", email, password, role: "admin" });
  }

  console.log(`✅ Admin ready → ${email} / ${password}`);
  console.log("   Login at: /auth/login?portal=admin");
  process.exit(0);
})();