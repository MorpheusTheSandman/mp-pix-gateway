const express = require("express");
const router = express.Router();
const publicController = require("../controllers/public.controller");

router.get("/charges/:token", publicController.getPublicCharge);
router.post("/charges/:token/pay/pix", publicController.payPublicPix);
router.post("/charges/:token/pay/card", publicController.payPublicCard);

module.exports = router;
