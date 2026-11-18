const router = require("express").Router();
const digilockerController = require("../controllers/digilocker.controller");
const auth = require("../middlewares/auth.middleware");

router.post("/initiate", auth, digilockerController.initiate);
router.get("/complete", auth, digilockerController.complete);
router.post("/complete", auth, digilockerController.complete);
router.get("/status", auth, digilockerController.getStatus);

module.exports = router;
