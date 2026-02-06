const express = require("express");
const router = express.Router();
const chargeController = require("../controllers/charge.controller");
const paymentController = require("../controllers/payment.controller");

router.post("/", chargeController.createCharge);
router.get("/", chargeController.listCharges);
router.get("/:id", chargeController.getCharge);
router.post("/:id/pay/pix", paymentController.payPix);
router.post("/:id/pay/card", paymentController.payCard);
router.post("/:id/refund", paymentController.refundCharge);
router.get("/:id/refunds", paymentController.listChargeRefunds);

module.exports = router;
