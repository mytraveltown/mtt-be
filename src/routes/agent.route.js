const fs = require("fs");
const path = require("path");
const router = require("express").Router();
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const agentController = require("../controllers/agent.controller");
const agentNotificationController = require("../controllers/agentNotification.controller");
const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");

const uploadDir = path.join(__dirname, "../../uploads/agents");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `agent_${req.user.id}_${file.fieldname}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif|pdf/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error("Only image or PDF files are allowed"));
  },
});

const handleAgentUpload = (req, res, next) => {
  upload.fields([
    { name: "aadhar", maxCount: 1 },
    { name: "aadhar_back", maxCount: 1 },
    { name: "dl", maxCount: 1 },
    { name: "dl_back", maxCount: 1 },
    { name: "company_document", maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
};

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
router.post("/", auth, handleAgentUpload, agentController.create);
router.put("/me", auth, handleAgentUpload, agentController.updateMine);
router.delete("/me", auth, agentController.deleteMine);
router.delete("/:id", auth, role(["admin"]), agentController.deleteById);

router.get("/", agentController.getAll);
router.get("/:id", agentController.getById);

module.exports = router;
