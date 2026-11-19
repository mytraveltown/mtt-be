const router = require("express").Router();
const packageController = require("../controllers/package.controller");
const auth = require("../middlewares/auth.middleware");
const optionalAuth = require("../middlewares/optionalAuth.middleware");
const role = require("../middlewares/role.middleware");
const formFields = require("../middlewares/formFields.middleware");

router.get("/mine",auth, role(["agent", "admin"]), packageController.getMine);
router.get("/manage", auth, role(["admin"]), packageController.getManageList);
router.post("/",auth, role(["agent", "admin"]), formFields, packageController.create);
router.put("/:id",auth, role(["agent", "admin"]), formFields, packageController.update);
router.delete("/:id",auth, role(["agent", "admin"]), packageController.delete);
router.delete("/:id/media/:mediaId",auth, role(["agent", "admin"]), packageController.deleteMedia);

router.get("/locations", packageController.getLocations);
router.get("/price-range", packageController.getPriceRange);
router.get("/trending-destinations", packageController.getTrendingDestinations);
router.get("/type-counts", packageController.getTypeCounts);
router.get("/", packageController.getAll);
router.get("/:id", optionalAuth, packageController.getById);

module.exports = router;
