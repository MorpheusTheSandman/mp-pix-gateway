const express = require("express");
const router = express.Router();
const webhookController = require("../controllers/webhook.controller");

router.post("/webhooks/mercadopago", (req, res) => res.sendStatus(404));
router.post("/v1/webhooks/mercadopago/:secret", webhookController.handleMercadoPagoWebhook);

module.exports = router;
