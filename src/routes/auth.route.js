const router = require("express").Router();
const authController = require("../controllers/auth.controller");
const auth = require("../middlewares/auth.middleware");
const formFields = require("../middlewares/formFields.middleware");

router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/otp/send", authController.sendLoginOtp);
router.post("/otp/verify", authController.verifyLoginOtp);
router.post("/otp/reset/send", authController.sendResetOtp);
router.post("/otp/reset/confirm", authController.resetPasswordWithOtp);
router.put("/update-profile", auth, formFields, authController.updateProfile);
router.post("/change-password", auth, authController.changePassword);
router.get("/my-profile", auth, authController.myProfile);
router.post("/otp/phone-update", auth, authController.phoneUpdate);
router.post("/otp/phone-update-verify",auth, authController.verifyPhoneUpdate);

module.exports = router;
