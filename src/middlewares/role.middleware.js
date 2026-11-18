const User = require("../models/user.model");

module.exports = (roles = []) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Use DB role — JWT role can be stale after agent registration
      req.user.role = user.role;

      if (!roles.includes(user.role)) {
        return res.status(403).json({ message: "Access denied" });
      }

      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error", err: err.message });
    }
  };
};
