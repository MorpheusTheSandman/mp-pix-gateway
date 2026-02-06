const chargeService = require("../services/charge.service");
const paymentService = require("../services/payment.service");
const mpService = require("../services/mercadopago.service");
const { toClientCharge, isUuid, mapChargeStatus } = require("../utils/helpers");

async function createCharge(req, res) {
  const { amount, customer } = req.body || {};
  if (!amount) {
    return res.status(400).json({ error: "amount is required" });
  }

  if (customer) {
    const docNumber = String(customer.docNumber || "").trim();
    if (!customer.name || !docNumber) {
      return res.status(400).json({ error: "customer.name and customer.docNumber are required" });
    }
  }

  try {
    const charge = await chargeService.createCharge(req.body);
    res.status(201).json(toClientCharge(charge));
  } catch (err) {
    console.error("create charge error", err);
    res.status(500).json({ error: "failed to create charge" });
  }
}

async function listCharges(req, res) {
  try {
    const charges = await chargeService.listCharges();
    res.json(charges);
  } catch (err) {
    console.error("list charges error", err);
    res.status(500).json({ error: "failed to list charges" });
  }
}

async function getCharge(req, res) {
  const chargeId = req.params.id;

  if (!isUuid(chargeId)) {
    return res.status(400).json({ error: "invalid charge id" });
  }

  try {
    const charge = await chargeService.getChargeById(chargeId);
    if (!charge) {
      return res.status(404).json({ error: "charge not found" });
    }

    const latestTx = await paymentService.getLatestPaymentTransaction(charge.id);
    if (latestTx?.provider_payment_id) {
      const mpStatusData = await mpService.getPayment(latestTx.provider_payment_id).catch(() => ({}));
      if (mpStatusData.status) {
        const mappedStatus = mapChargeStatus(mpStatusData.status);
        if (mappedStatus && mappedStatus !== charge.status) {
          await chargeService.updateChargeStatus(charge.id, mappedStatus);
          charge.status = mappedStatus;
        }
      }
    }

    res.json(toClientCharge(charge));
  } catch (err) {
    console.error("get charge error", err);
    res.status(500).json({ error: "failed to fetch charge" });
  }
}

module.exports = {
  createCharge,
  listCharges,
  getCharge,
};
