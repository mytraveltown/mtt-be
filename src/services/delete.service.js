const fs = require("fs");
const path = require("path");
const db = require("../config/db");
const Agent = require("../models/agent.model");
const User = require("../models/user.model");
const TravelPackage = require("../models/package.model");
const Review = require("../models/review.model");

const deleteFile = (filePath, prefix) => {
  if (!filePath?.startsWith(prefix)) return;
  const fullPath = path.join(__dirname, "../..", filePath.replace(/^\//, ""));
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
};

const deleteAgentDocuments = (agent) => {
  deleteFile(agent.aadhar_document, "/uploads/agents/");
  deleteFile(agent.aadhar_document_back, "/uploads/agents/");
  deleteFile(agent.dl_document, "/uploads/agents/");
  deleteFile(agent.dl_document_back, "/uploads/agents/");
};

const deletePackageMediaFiles = async (packageId) => {
  const media = await TravelPackage.getMedia(packageId);
  media.forEach((item) => deleteFile(item.file_path, "/uploads/packages/"));
};

const deleteReviewMediaFiles = (filePaths) => {
  filePaths.forEach((filePath) => deleteFile(filePath, "/uploads/reviews/"));
};

const deletePackageFull = async (packageId) => {
  await deletePackageMediaFiles(packageId);
  // Review rows cascade with the package; their uploaded files do not.
  deleteReviewMediaFiles(await Review.getMediaPathsByPackageId(packageId));
  await db.query("DELETE FROM travel_package_media WHERE package_id = ?", [packageId]);
  await db.query("DELETE FROM travel_package_day WHERE package_id = ?", [packageId]);
  await db.query("DELETE FROM bookings WHERE package_id = ?", [packageId]);
  await TravelPackage.delete(packageId);
};

const deleteAllAgentPackages = async (agentId) => {
  const packages = await TravelPackage.findByAgentId(agentId);
  for (const pkg of packages) {
    await deletePackageFull(pkg.id);
  }
};

const revokeAgent = async (agent) => {
  deleteAgentDocuments(agent);
  await deleteAllAgentPackages(agent.id);
  await Agent.delete(agent.id);

  const user = await User.findById(agent.user_id);
  if (user && user.role === "agent") {
    await User.update(agent.user_id, { role: "user" });
  }
};

const deleteUserFull = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    return { error: "User not found", status: 404 };
  }

  const agent = await Agent.findByUserId(userId);
  if (agent) {
    await revokeAgent(agent);
  }

  deleteReviewMediaFiles(await Review.getMediaPathsByUserId(userId));
  await db.query("DELETE FROM bookings WHERE user_id = ?", [userId]);
  await db.query("DELETE FROM digilocker_sessions WHERE user_id = ?", [userId]);
  await db.query("DELETE FROM login_otps WHERE user_id = ?", [userId]);
  deleteFile(user.profile, "/uploads/users/");
  await User.delete(userId);

  return { success: true };
};

module.exports = {
  deleteFile,
  deletePackageFull,
  deleteAllAgentPackages,
  revokeAgent,
  deleteUserFull,
};
