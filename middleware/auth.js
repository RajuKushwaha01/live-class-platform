// Check if user is logged in
const isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  return res.redirect("/auth/login");
};

// Check role-based access
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect("/auth/login");
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render("error", {
        message: "Access Denied — You don't have permission to view this page.",
      });
    }
    next();
  };
};

// Check if user is blocked
const checkBlocked = async (req, res, next) => {
  const User = require("../models/User");
  if (req.session.user) {
    const user = await User.findById(req.session.user._id);
    if (user && user.isBlocked) {
      req.session.destroy();
      return res.redirect("/auth/login?blocked=true");
    }
  }
  next();
};

module.exports = { isAuthenticated, authorizeRoles, checkBlocked };