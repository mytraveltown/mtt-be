const db = require("../config/db");
const Agent = require("../models/agent.model");
const User = require("../models/user.model");
const TravelPackage = require("../models/package.model");
const Review = require("../models/review.model");
const { deleteStoredFile, deleteStoredFiles } = require("./media.service");

// Each helper handles S3 ("/media/...") and legacy local ("/uploads/...") paths.
const deleteAgentDocuments = (agent) =>
  deleteStoredFiles([
    agent.aadhar_document,
    agent.aadhar_document_back,
    agent.dl_document,
    agent.dl_document_back,
    agent.company_document,
  ]);

const deletePackageMediaFiles = async (packageId) => {
  const media = await TravelPackage.getMedia(packageId);
  await deleteStoredFiles(media.map((item) => item.file_path));
};

const deleteReviewMediaFiles = (filePaths) => deleteStoredFiles(filePaths);

const deletePackageFull = async (packageId) => {
  await deletePackageMediaFiles(packageId);
  // Review rows cascade with the package; their uploaded files do not.
  await deleteReviewMediaFiles(await Review.getMediaPathsByPackageId(packageId));
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
  await deleteAgentDocuments(agent);
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

  await deleteReviewMediaFiles(await Review.getMediaPathsByUserId(userId));
  await db.query("DELETE FROM bookings WHERE user_id = ?", [userId]);
  await db.query("DELETE FROM digilocker_sessions WHERE user_id = ?", [userId]);
  await db.query("DELETE FROM login_otps WHERE user_id = ?", [userId]);
  await deleteStoredFile(user.profile);
  await User.delete(userId);

  return { success: true };
};

module.exports = {
  deletePackageFull,
  deleteAllAgentPackages,
  revokeAgent,
  deleteUserFull,
};
