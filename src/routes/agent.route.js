const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const agentController = require("../controllers/agent.controller");
const agentNotificationController = require("../controllers/agentNotification.controller");
const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");
const formFields = require("../middlewares/formFields.middleware");

// The header bell polls about once a minute; this only guards against runaway clients.
const notificationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later.", data: null },
});

router.get("/me", auth, agentController.getMine);
router.get("/me/notifications", notificationsLimiter, auth, role(["agent"]), agentNotificationController.list);
router.post("/me/notifications/read", notificationsLimiter, auth, role(["agent"]), agentNotificationController.markAllRead);
router.get("/manage", auth, role(["admin"]), agentController.getManageList);
router.post("/reminders/no-packages", auth, role(["admin"]), agentController.sendPackageReminders);
router.put("/:id/verification", auth, role(["admin"]), agentController.verify);
router.post("/", auth, formFields, agentController.create);
router.put("/me", auth, formFields, agentController.updateMine);
router.delete("/me", auth, agentController.deleteMine);
router.delete("/:id", auth, role(["admin"]), agentController.deleteById);

router.get("/", agentController.getAll);
router.get("/:id", agentController.getById);

module.exports = router;
