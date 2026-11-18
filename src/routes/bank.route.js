const fs = require("fs");
const path = require("path");
const router = require("express").Router();
const multer = require("multer");

const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");
const bankController = require("../controllers/bank.controller");

const uploadDir = path.join(__dirname, "../../uploads/bank");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `bank_${req.user.id}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const allowedExt = /\.(jpg|jpeg|png|pdf)$/i;
    const allowedMime = [
      "image/jpeg",
      "image/png",
      "application/pdf",
    ];

    if (
      allowedExt.test(file.originalname) &&
      allowedMime.includes(file.mimetype)
    ) {
      return cb(null, true);
    }

    cb(new Error("Only JPG, PNG and PDF files are allowed."));
  },
});

const uploadBankDocument = (req, res, next) => {
  upload.single("bank_document")(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    next();
  });
};



router.get("/",auth,role(["agent", "admin"]),bankController.myBankDetails);
router.put("/bank-details",auth,role(["agent", "admin"]),uploadBankDocument,bankController.updateBankDetails);
router.get("/:id",auth,role(["admin"]),bankController.getByUserId);

module.exports = router;