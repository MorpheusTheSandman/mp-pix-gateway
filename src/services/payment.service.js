const { randomUUID } = require("crypto");
const { query } = require("../db");
const mpService = require("./mercadopago.service");
const {
  extractPixData,
  normalizePaymentStatus,
  mapChargeStatus,
  pickValue,
  webhookUrl,
  parseChargeId,
} = require("../utils/helpers");
const chargeService = require("./charge.service");

async function getLatestPaymentTransaction(chargeId) {
  const result = await query(
    `SELECT *
     FROM payment_transactions
     WHERE charge_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [chargeId]
  );
  return result.rows[0] || null;
}

async function createPixPayment(charge) {
  let payer = null;
  if (charge.customer_id) {
    const customerResult = await query("SELECT * FROM customers WHERE id = $1", [
      charge.customer_id,
    ]);
    payer = customerResult.rows[0] || null;
  }

  const body = {
    description: charge.description || "Cobranca MEI",
    transaction_amount: Number(charge.amount),
    payment_method_id: "pix",
    payer: payer
      ? {
          email: payer.email || "cliente@email.com",
          first_name: payer.name?.split(" ")[0] || "Cliente",
          last_name: payer.name?.split(" ").slice(1).join(" ") || "MEI",
        }
      : {
          email: "cliente@email.com",
          first_name: "Cliente",
          last_name: "MEI",
        },
    external_reference: `charge_${charge.id}`,
    metadata: {
      charge_id: charge.id,
    },
  };
  const notifyUrl = webhookUrl();
  if (notifyUrl) {
    body.notification_url = notifyUrl;
  }

  const data = await mpService.createPix(body);

  const pixData = extractPixData(data);
  const transactionId = randomUUID();
  const providerStatus = normalizePaymentStatus(data.status);

  await query(
    `INSERT INTO payment_transactions
     (id, charge_id, provider, provider_order_id, provider_payment_id, method, status, qr_code, qr_code_base64, copy_paste, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      transactionId,
      charge.id,
      "mercadopago",
      null,
      data.id ? String(data.id) : null,
      "pix",
      providerStatus,
      pixData.qr_code,
      pixData.qr_code_base64,
      pixData.copy_paste,
      data,
    ]
  );

  await chargeService.updateChargeStatus(charge.id, mapChargeStatus(providerStatus));

  return {
    charge_id: charge.id,
    provider_order_id: null,
    qr_code: pixData.qr_code,
    qr_code_base64: pixData.qr_code_base64,
    copy_paste: pixData.copy_paste,
    ticket_url: pixData.ticket_url,
    raw: data,
  };
}

async function createCardPayment(charge, payload) {
  const cardData = payload.card || {};
  const token = payload.token || pickValue(cardData, ["token"]);
  const paymentMethodId =
    payload.payment_method_id || pickValue(cardData, ["payment_method_id", "paymentMethodId"]);
  const issuerId = payload.issuer_id || pickValue(cardData, ["issuer_id", "issuerId"]);
  const installments = payload.installments || pickValue(cardData, ["installments"]);
  const paymentTypeId =
    payload.payment_type_id ||
    pickValue(cardData, ["payment_type_id", "paymentTypeId", "payment_type"]);
  const payerEmail =
    payload.payer_email ||
    cardData?.payer?.email ||
    cardData?.cardholderEmail ||
    cardData?.cardholder_email;
  const payerIdentification = payload.payer_identification || cardData?.payer?.identification;

  if (!token || !paymentMethodId) {
    throw new Error("missing_card_token");
  }

  let payer = null;
  if (charge.customer_id) {
    const customerResult = await query("SELECT * FROM customers WHERE id = $1", [
      charge.customer_id,
    ]);
    payer = customerResult.rows[0] || null;
  }

  const installmentsValue = paymentTypeId === "debit_card" ? 1 : Number(installments || 1);

  const body = {
    description: charge.description || "Cobranca MEI",
    transaction_amount: Number(charge.amount),
    token,
    installments: installmentsValue,
    payment_method_id: paymentMethodId,
    payer: {
      email: payerEmail || payer?.email || "cliente@email.com",
      first_name: payer?.name?.split(" ")[0] || "Cliente",
      last_name: payer?.name?.split(" ").slice(1).join(" ") || "MEI",
    },
    external_reference: `charge_${charge.id}`,
    metadata: {
      charge_id: charge.id,
    },
  };

  if (issuerId) {
    body.issuer_id = issuerId;
  }
  if (paymentTypeId) {
    body.payment_type_id = paymentTypeId;
  }
  if (payerIdentification) {
    body.payer.identification = payerIdentification;
  }

  const data = await mpService.createCard(body);

  const transactionId = randomUUID();
  const providerStatus = normalizePaymentStatus(data.status);

  await query(
    `INSERT INTO payment_transactions
     (id, charge_id, provider, provider_order_id, provider_payment_id, method, status, qr_code, qr_code_base64, copy_paste, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      transactionId,
      charge.id,
      "mercadopago",
      null,
      data.id ? String(data.id) : null,
      paymentTypeId || "card",
      providerStatus,
      null,
      null,
      null,
      data,
    ]
  );

  await chargeService.updateChargeStatus(charge.id, mapChargeStatus(providerStatus));

  return {
    charge_id: charge.id,
    provider_payment_id: data.id || null,
    status: providerStatus,
    raw: data,
  };
}

async function refundCharge(chargeId, amount) {
  const charge = await chargeService.getChargeById(chargeId);
  if (!charge) throw new Error("charge_not_found");

  const tx = await getLatestPaymentTransaction(chargeId);
  if (!tx?.provider_payment_id) {
    throw new Error("payment_not_found");
  }

  const mpStatusData = await mpService.getPayment(tx.provider_payment_id);

  if (normalizePaymentStatus(mpStatusData?.status) !== "approved") {
    const err = new Error("payment_not_approved");
    err.details = {
        mp_status: mpStatusData?.status || null,
        mp_status_detail: mpStatusData?.status_detail || null,
    };
    throw err;
  }

  const refundData = await mpService.refundPayment(tx.provider_payment_id, amount);

  const refundPaymentId = refundData?.id ? String(refundData.id) : null;
  await query(
    `INSERT INTO payment_transactions
     (id, charge_id, provider, provider_order_id, provider_payment_id, method, status, qr_code, qr_code_base64, copy_paste, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      randomUUID(),
      charge.id,
      "mercadopago",
      tx.provider_payment_id || tx.provider_order_id || null,
      refundPaymentId,
      "refund",
      "approved",
      null,
      null,
      null,
      refundData,
    ]
  );

  await chargeService.updateChargeStatus(charge.id, "CANCELED");
  await chargeService.updateChargePublicExpiresAt(charge.id);

  return refundData;
}

async function listRefunds(chargeId) {
  const result = await query(
    `SELECT id, provider_payment_id, status, updated_at, raw_payload
     FROM payment_transactions
     WHERE charge_id = $1 AND method = 'refund'
     ORDER BY updated_at DESC`,
    [chargeId]
  );
  return result.rows;
}

async function listAllRefunds() {
  const result = await query(
    `SELECT pt.id,
            pt.charge_id,
            pt.provider_payment_id,
            pt.status,
            pt.updated_at,
            pt.raw_payload,
            c.description,
            c.amount,
            cu.name AS customer_name
     FROM payment_transactions pt
     JOIN charges c ON c.id = pt.charge_id
     LEFT JOIN customers cu ON cu.id = c.customer_id
     WHERE pt.method = 'refund'
     ORDER BY pt.updated_at DESC
     LIMIT 200`
  );
  return result.rows;
}

async function recordWebhookEvent(event, signatureValid) {
  const eventId = randomUUID();
  const eventType = event.type || event.action || null;
  const externalId = event?.data?.id ? String(event.data.id) : event.id ? String(event.id) : null;

  try {
    await query(
      `INSERT INTO webhook_events
       (id, provider, event_type, external_id, payload, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        eventId,
        "mercadopago",
        eventType,
        externalId,
        event,
        signatureValid ? "received" : "invalid_signature",
      ]
    );
  } catch (err) {
    console.error("webhook insert error", err);
  }
  return { eventId, externalId };
}

async function processWebhookPayment(externalId, eventId) {
  try {
    const paymentData = await mpService.getPayment(externalId);

    const externalReference = paymentData.external_reference || null;
    const chargeId = parseChargeId(externalReference) || paymentData.metadata?.charge_id || null;
    if (!chargeId) {
      return;
    }

    const newStatus = mapChargeStatus(normalizePaymentStatus(paymentData.status));

    const chargeCheck = await query("SELECT 1 FROM charges WHERE id = $1", [chargeId]);
    if (chargeCheck.rowCount === 0) {
      return;
    }

    await chargeService.updateChargeStatus(chargeId, newStatus);

    const paymentTypeId = paymentData.payment_type_id || paymentData.payment_method_id || "unknown";
    const isPix =
      paymentData.payment_method_id === "pix" || paymentData.payment_type_id === "pix";
    const pixData = isPix
      ? extractPixData(paymentData)
      : { qr_code: null, qr_code_base64: null, copy_paste: null };

    await query(
      `INSERT INTO payment_transactions
       (id, charge_id, provider, provider_order_id, provider_payment_id, method, status, qr_code, qr_code_base64, copy_paste, raw_payload, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT ON CONSTRAINT payment_transactions_provider_payment_id_idx
       DO UPDATE SET status = EXCLUDED.status, raw_payload = EXCLUDED.raw_payload, updated_at = now()`,
      [
        randomUUID(),
        chargeId,
        "mercadopago",
        paymentData.order?.id ? String(paymentData.order.id) : null,
        paymentData.id ? String(paymentData.id) : null,
        paymentTypeId,
        normalizePaymentStatus(paymentData.status),
        pixData.qr_code,
        pixData.qr_code_base64,
        pixData.copy_paste,
        paymentData,
      ]
    );

    await query("UPDATE webhook_events SET processed_at = now(), status = $1 WHERE id = $2", [
      "processed",
      eventId,
    ]);
  } catch (err) {
    console.error("webhook processing error", err);
  }
}

module.exports = {
  createPixPayment,
  createCardPayment,
  refundCharge,
  listRefunds,
  listAllRefunds,
  getLatestPaymentTransaction,
  recordWebhookEvent,
  processWebhookPayment
};
