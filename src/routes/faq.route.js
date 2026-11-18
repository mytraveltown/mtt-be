const router = require("express").Router();
const faqController = require("../controllers/faq.controller");
const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");

router.get("/", faqController.getByPage);
router.get("/manage", auth, role(["admin"]), faqController.getAll);
router.post("/", auth, role(["admin"]), faqController.create);
router.put("/:id", auth, role(["admin"]), faqController.update);
router.delete("/:id", auth, role(["admin"]), faqController.remove);

module.exports = router;
