const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const role = require("../middlewares/role.middleware");
const formFields = require("../middlewares/formFields.middleware");
const bankController = require("../controllers/bank.controller");

router.get("/",auth,role(["agent", "admin"]),bankController.myBankDetails);
router.put("/bank-details",auth,role(["agent", "admin"]),formFields,bankController.updateBankDetails);
router.get("/:id",auth,role(["admin"]),bankController.getByUserId);

module.exports = router;