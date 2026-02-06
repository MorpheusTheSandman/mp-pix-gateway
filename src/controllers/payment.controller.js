const paymentService = require("../services/payment.service");
const chargeService = require("../services/charge.service");
const { isUuid } = require("../utils/helpers");

async function payPix(req, res) {
  const chargeId = req.params.id;

  if (!isUuid(chargeId)) {
    return res.status(400).json({ error: "invalid charge id" });
  }

  try {
    const charge = await chargeService.getChargeById(chargeId);
    if (!charge) {
      return res.status(404).json({ error: "charge not found" });
    }

    if (charge.status === "PAID") {
      return res.status(409).json({ error: "charge already paid" });
    }

    const response = await paymentService.createPixPayment(charge);
    res.json(response);
  } catch (err) {
    console.error("pay pix error", err);
    res.status(500).json({ error: "failed to create pix" });
  }
}

async function payCard(req, res) {
  const chargeId = req.params.id;
  const payload = req.body || {};

  if (!isUuid(chargeId)) {
    return res.status(400).json({ error: "invalid charge id" });
  }

  try {
    const charge = await chargeService.getChargeById(chargeId);
    if (!charge) {
      return res.status(404).json({ error: "charge not found" });
    }

    if (charge.status === "PAID") {
      return res.status(409).json({ error: "charge already paid" });
    }
    const response = await paymentService.createCardPayment(charge, payload);
    res.json(response);
  } catch (err) {
    if (err?.message === "missing_card_token") {
      return res.status(400).json({ error: "missing card token or payment_method_id" });
    }
    console.error("pay card error", err);
    res.status(500).json({ error: "failed to create card payment" });
  }
}

async function refundCharge(req, res) {
  const chargeId = req.params.id;
  const amount = req.body?.amount || null;

  if (!isUuid(chargeId)) {
    return res.status(400).json({ error: "invalid charge id" });
  }

  try {
    const refundData = await paymentService.refundCharge(chargeId, amount);
    return res.json({ status: "REFUNDED", refund: refundData });
  } catch (err) {
    console.error("refund charge error", err);
    if (err.message === "charge_not_found") return res.status(404).json({ error: "charge not found" });
    if (err.message === "payment_not_found") return res.status(409).json({ error: "payment_not_found", message: "Nao foi encontrado pagamento para reembolso." });
    if (err.message === "payment_not_approved") return res.status(409).json({ error: "payment_not_approved", message: "Pagamento nao foi aprovado no Mercado Pago.", details: err.details });
    if (err.message === "failed_to_refund_payment") return res.status(409).json({ error: "refund_not_allowed", message: err.data?.message || "invalid refund status" });

    return res.status(500).json({ error: "failed to refund charge" });
  }
}

async function listChargeRefunds(req, res) {
  const chargeId = req.params.id;

  if (!isUuid(chargeId)) {
    return res.status(400).json({ error: "invalid charge id" });
  }

  try {
    const refunds = await paymentService.listRefunds(chargeId);
    res.json(refunds);
  } catch (err) {
    console.error("list refunds error", err);
    res.status(500).json({ error: "failed to list refunds" });
  }
}

async function listAllRefunds(req, res) {
  try {
    const refunds = await paymentService.listAllRefunds();
    res.json(refunds);
  } catch (err) {
    console.error("list all refunds error", err);
    res.status(500).json({ error: "failed to list refunds" });
  }
}

module.exports = {
  payPix,
  payCard,
  refundCharge,
  listChargeRefunds,
  listAllRefunds
};
