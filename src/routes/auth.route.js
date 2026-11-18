const fs = require("fs");
const path = require("path");
const router = require("express").Router();
const authController = require("../controllers/auth.controller");
const auth = require("../middlewares/auth.middleware");
const multer = require("multer");

const uploadDir = path.join(__dirname, "../../uploads/users");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `user_${req.user.id}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error("Only image files (jpg, png, webp, gif) are allowed"));
  },
});

const handleUpload = (req, res, next) => {
  upload.single("profile")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
};

router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/otp/send", authController.sendLoginOtp);
router.post("/otp/verify", authController.verifyLoginOtp);
router.post("/otp/reset/send", authController.sendResetOtp);
router.post("/otp/reset/confirm", authController.resetPasswordWithOtp);
router.put("/update-profile", auth, handleUpload, authController.updateProfile);
router.post("/change-password", auth, authController.changePassword);
router.get("/my-profile", auth, authController.myProfile);
router.post("/otp/phone-update", auth, authController.phoneUpdate);
router.post("/otp/phone-update-verify",auth, authController.verifyPhoneUpdate);

module.exports = router;
