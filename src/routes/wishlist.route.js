const router = require("express").Router();
const wishlistController = require("../controllers/wishlist.controller");
const auth = require("../middlewares/auth.middleware");

router.use(auth);

router.get("/", wishlistController.getMine);
router.get("/ids", wishlistController.getMyIds);
router.post("/:packageId", wishlistController.add);
router.delete("/:packageId", wishlistController.remove);

module.exports = router;
