const router = require("express").Router();
const userController = require("../controllers/user.controller");
const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");

router.get("/manage", auth, role(["admin"]), userController.getManageList);
router.delete("/:id", auth, role(["admin"]), userController.deleteById);

module.exports = router;
