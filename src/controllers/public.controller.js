const chargeService = require("../services/charge.service");
const paymentService = require("../services/payment.service");
const { mapStatusForClient, isPublicLinkExpired, isChargePayable } = require("../utils/helpers");

async function getPublicCharge(req, res) {
  const token = String(req.params.token || "").trim();
  if (!token) {
    return res.status(400).json({ error: "invalid_token" });
  }

  try {
    const charge = await chargeService.getChargeByPublicToken(token);
    if (!charge) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.json({
      id: charge.id,
      title: charge.description || "Cobranca",
      amount: Number(charge.amount),
      description: charge.description || null,
      status: mapStatusForClient(charge.status),
      customer_name: charge.customer_name || "",
      customer_email: charge.customer_email || null,
      public_expires_at: charge.public_expires_at || null,
      is_expired: isPublicLinkExpired(charge),
      can_pay: isChargePayable(charge),
    });
  } catch (err) {
    console.error("public charge lookup error", err);
    return res.status(500).json({ error: "failed_to_fetch" });
  }
}

async function payPublicPix(req, res) {
  const token = String(req.params.token || "").trim();
  if (!token) {
    return res.status(400).json({ error: "invalid_token" });
  }

  try {
    const charge = await chargeService.getChargeByPublicToken(token);
    if (!charge) {
      return res.status(404).json({ error: "not_found" });
    }
    if (isPublicLinkExpired(charge)) {
      return res.status(410).json({ error: "link_expired" });
    }
    if (!isChargePayable(charge)) {
      return res.status(409).json({ error: "charge_not_payable" });
    }
    if (charge.status === "PAID") {
      return res.status(409).json({ error: "charge_already_paid" });
    }

    const response = await paymentService.createPixPayment(charge);
    return res.json(response);
  } catch (err) {
    console.error("public pix error", err);
    return res.status(500).json({ error: "failed_to_create_pix" });
  }
}

async function payPublicCard(req, res) {
  const token = String(req.params.token || "").trim();
  const payload = req.body || {};
  if (!token) {
    return res.status(400).json({ error: "invalid_token" });
  }

  try {
    const charge = await chargeService.getChargeByPublicToken(token);
    if (!charge) {
      return res.status(404).json({ error: "not_found" });
    }
    if (isPublicLinkExpired(charge)) {
      return res.status(410).json({ error: "link_expired" });
    }
    if (!isChargePayable(charge)) {
      return res.status(409).json({ error: "charge_not_payable" });
    }
    if (charge.status === "PAID") {
      return res.status(409).json({ error: "charge_already_paid" });
    }

    const response = await paymentService.createCardPayment(charge, payload);
    return res.json(response);
  } catch (err) {
    if (err?.message === "missing_card_token") {
      return res.status(400).json({ error: "missing card token or payment_method_id" });
    }
    console.error("public card error", err);
    return res.status(500).json({ error: "failed_to_create_card" });
  }
}

module.exports = {
  getPublicCharge,
  payPublicPix,
  payPublicCard
};
