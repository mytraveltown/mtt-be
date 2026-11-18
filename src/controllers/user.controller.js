const User = require("../models/user.model");
const { deleteUserFull } = require("../services/delete.service");

exports.getManageList = async (req, res) => {
  try {
    const result = await User.findPaginated({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.q?.trim() || null,
      role: req.query.role || null,
    });
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.deleteById = async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (!targetId) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    if (targetId === req.user.id) {
      return res.status(400).json({ message: "You cannot delete your own account" });
    }

    const target = await User.findById(targetId);
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }

    if (target.role === "admin") {
      return res.status(400).json({ message: "Admin accounts cannot be deleted" });
    }

    const result = await deleteUserFull(targetId);
    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }

    res.status(200).json({ message: "User and all related data deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};
