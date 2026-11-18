const router = require("express").Router();
const bookingController = require("../controllers/booking.controller");
const auth = require("../middlewares/auth.middleware");
const optionalAuth = require("../middlewares/optionalAuth.middleware");
const role = require("../middlewares/role.middleware");

router.post("/", optionalAuth, bookingController.create);
router.get("/mine", auth, bookingController.getMine);
router.get("/manage", auth, role(["admin", "agent"]), bookingController.getManage);
router.get("/blocked-dates/:packageId", bookingController.getBlockedDates);
router.post("/verify-balance", bookingController.verifyBalancePayment);
router.post("/:id/balance-order", bookingController.createBalanceOrder);
router.put(
  "/:id/balance-received",
  auth,
  role(["admin", "agent"]),
  bookingController.markBalanceReceivedByAgent
);
router.get("/:id", bookingController.getById);
router.get("/", auth, role(["admin"]), bookingController.getAll);
router.put("/:id/status", auth, role(["admin", "agent"]), bookingController.updateStatus);
router.post("/verify-payment", optionalAuth, bookingController.verifyPayment);

module.exports = router;
