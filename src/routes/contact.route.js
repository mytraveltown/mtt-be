const router = require("express").Router();
const contactController = require("../controllers/contact.controller");
const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");

router.post("/", contactController.create);
router.get("/", auth, role(["admin"]), contactController.getAll);
router.get("/:id", auth, role(["admin"]), contactController.getById);
router.delete("/:id", auth, role(["admin"]), contactController.remove);

module.exports = router;
