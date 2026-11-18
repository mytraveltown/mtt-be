const fs = require("fs");
const path = require("path");
const router = require("express").Router();
const multer = require("multer");
const packageController = require("../controllers/package.controller");
const auth = require("../middlewares/auth.middleware");
const optionalAuth = require("../middlewares/optionalAuth.middleware");
const role = require("../middlewares/role.middleware");

const uploadDir = path.join(__dirname, "../../uploads/packages");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `package_${req.user.id}_${Date.now()}_${Math.round(Math.random() * 1e5)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif|mp4|mov|webm|avi|mkv/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype);
    if (extOk || mimeOk) return cb(null, true);
    cb(new Error("Only image or video files are allowed"));
  },
});

const handleGalleryUpload = (req, res, next) => {
  upload.array("gallery", 20)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
};

router.get("/mine",auth, role(["agent", "admin"]), packageController.getMine);
router.get("/manage", auth, role(["admin"]), packageController.getManageList);
router.post("/",auth, role(["agent", "admin"]), handleGalleryUpload, packageController.create);
router.put("/:id",auth, role(["agent", "admin"]), handleGalleryUpload, packageController.update);
router.delete("/:id",auth, role(["agent", "admin"]), packageController.delete);
router.delete("/:id/media/:mediaId",auth, role(["agent", "admin"]), packageController.deleteMedia);

router.get("/locations", packageController.getLocations);
router.get("/price-range", packageController.getPriceRange);
router.get("/trending-destinations", packageController.getTrendingDestinations);
router.get("/type-counts", packageController.getTypeCounts);
router.get("/", packageController.getAll);
router.get("/:id", optionalAuth, packageController.getById);

module.exports = router;
