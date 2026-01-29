require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const hpp = require("hpp");
const rateLimit = require("express-rate-limit");
const pinoHttp = require("pino-http");
const { randomUUID, createHmac, randomBytes } = require("crypto");
const { query } = require("./db");

const app = express();

const PORT = process.env.PORT || 3000;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_BASE_URL = process.env.MP_BASE_URL || "https://api.mercadopago.com";
const MP_PAYMENT_ENDPOINT = process.env.MP_PAYMENT_ENDPOINT || "/v1/payments";
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || "";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || "";
const MP_WEBHOOK_PATH_SECRET = process.env.MP_WEBHOOK_PATH_SECRET || "";

const allowedOrigins = new Set(
  [PUBLIC_APP_URL, "http://localhost:5173", "http://127.0.0.1:5173"].filter(Boolean)
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

app.set("trust proxy", 1);
app.use(
  pinoHttp({
    quietReqLogger: true,
    redact: ["req.headers.authorization"],
  })
);
app.use(helmet());
app.use(hpp());
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

function mpHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function webhookUrl() {
  if (!PUBLIC_BASE_URL || !MP_WEBHOOK_PATH_SECRET) return null;
  const base = normalizeBaseUrl(PUBLIC_BASE_URL);
  return `${base}/api/v1/webhooks/mercadopago/${MP_WEBHOOK_PATH_SECRET}`;
}

function publicChargeUrl(token) {
  if (!PUBLIC_APP_URL || !token) return null;
  const base = normalizeBaseUrl(PUBLIC_APP_URL);
  return `${base}/#/p/${token}`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function parseChargeId(externalReference) {
  if (!externalReference) return null;
  if (externalReference.startsWith("charge_")) {
    return externalReference.replace("charge_", "");
  }
  return null;
}

function mapChargeStatus(paymentStatus) {
  switch (paymentStatus) {
    case "approved":
      return "PAID";
    case "pending":
    case "in_process":
    case "in_mediation":
      return "PENDING";
    case "rejected":
    case "cancelled":
      return "CANCELED";
    case "expired":
      return "EXPIRED";
    default:
      return "PENDING";
  }
}

function mapStatusForClient(status) {
  switch (status) {
    case "PAID":
      return "PAID";
    case "PENDING":
      return "PENDING";
    case "DRAFT":
      return "PENDING";
    case "CANCELED":
      return "CANCELLED";
    case "EXPIRED":
      return "FAILED";
    default:
      return "PENDING";
  }
}

function normalizePaymentStatus(status) {
  if (!status) return "pending";
  const normalized = status.toLowerCase();
  const allowed = new Set(["pending", "approved", "rejected", "cancelled", "expired"]);
  if (normalized === "in_process" || normalized === "in_mediation") {
    return "pending";
  }
  if (allowed.has(normalized)) {
    return normalized;
  }
  return "pending";
}

function extractPixData(data) {
  const transactionData =
    data?.point_of_interaction?.transaction_data || data?.transaction_data || {};
  const qrCode = transactionData.qr_code || data?.qr_code || null;
  const qrCodeBase64 = transactionData.qr_code_base64 || data?.qr_code_base64 || null;
  const copyPaste = transactionData.qr_code || data?.qr_code || data?.copy_paste || null;
  const ticketUrl =
    transactionData.ticket_url ||
    data?.point_of_interaction?.transaction_data?.ticket_url ||
    data?.ticket_url ||
    null;

  return {
    qr_code: qrCode,
    qr_code_base64: qrCodeBase64,
    copy_paste: copyPaste,
    ticket_url: ticketUrl,
  };
}

function toClientCharge(row) {
  return {
    id: row.id,
    title: row.description || "Cobranca",
    description: row.description || null,
    amount: Number(row.amount),
    status: mapStatusForClient(row.status),
    customer_name: row.customer_name || "",
    customer_email: row.customer_email || null,
    customer_doc: row.customer_doc || null,
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
    qr_code: row.qr_code || null,
    qr_code_base64: row.qr_code_base64 || null,
    public_token: row.public_token || null,
    public_expires_at: row.public_expires_at || null,
    public_url: row.public_token ? publicChargeUrl(row.public_token) : null,
  };
}

function pickValue(source, keys) {
  if (!source) return null;
  for (const key of keys) {
    if (source[key]) {
      return source[key];
    }
  }
  return null;
}

function verifyMpWebhookSignature(req) {
  if (!MP_WEBHOOK_SECRET) return true;
  const signature = req.headers["x-signature"];
  const requestId = req.headers["x-request-id"];
  if (!signature || !requestId) return false;

  const parts = String(signature)
    .split(",")
    .map((part) => part.trim());
  const tsPart = parts.find((part) => part.startsWith("ts="));
  const v1Part = parts.find((part) => part.startsWith("v1="));
  if (!tsPart || !v1Part) return false;

  const ts = tsPart.split("=")[1];
  const v1 = v1Part.split("=")[1];
  if (!ts || !v1) return false;

  const eventId = req.body?.data?.id || req.body?.id || "";
  const manifest = `id:${eventId};request-id:${requestId};ts:${ts};`;
  const expected = createHmac("sha256", MP_WEBHOOK_SECRET).update(manifest).digest("hex");

  return expected === v1;
}

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

async function getChargeById(chargeId) {
  const result = await query(
    `SELECT c.*, cu.name as customer_name, cu.email as customer_email, cu.cpf_cnpj as customer_doc,
            pt.qr_code, pt.qr_code_base64
     FROM charges c
     LEFT JOIN customers cu ON cu.id = c.customer_id
     LEFT JOIN LATERAL (
       SELECT qr_code, qr_code_base64
       FROM payment_transactions pt
       WHERE pt.charge_id = c.id
       ORDER BY pt.updated_at DESC
       LIMIT 1
     ) pt ON true
     WHERE c.id = $1`,
    [chargeId]
  );
  return result.rows[0] || null;
}

async function getChargeByPublicToken(token) {
  const result = await query(
    `SELECT c.*, cu.name as customer_name, cu.email as customer_email, cu.cpf_cnpj as customer_doc
     FROM charges c
     LEFT JOIN customers cu ON cu.id = c.customer_id
     WHERE c.public_token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

function isPublicLinkExpired(charge) {
  if (!charge?.public_expires_at) return false;
  return new Date(charge.public_expires_at).getTime() < Date.now();
}

function isChargePayable(charge) {
  return charge && charge.status === "PENDING";
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

  const mpResponse = await fetch(`${MP_BASE_URL}${MP_PAYMENT_ENDPOINT}`, {
    method: "POST",
    headers: mpHeaders({
      "X-Idempotency-Key": randomUUID(),
    }),
    body: JSON.stringify(body),
  });

  const data = await mpResponse.json();
  if (!mpResponse.ok) {
    console.error("MP error", data);
    throw new Error("failed_to_create_pix");
  }

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

  await query("UPDATE charges SET status = $1 WHERE id = $2", [
    mapChargeStatus(providerStatus),
    charge.id,
  ]);

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
    payload.payment_type_id || pickValue(cardData, ["payment_type_id", "paymentTypeId", "payment_type"]);
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

  const mpResponse = await fetch(`${MP_BASE_URL}${MP_PAYMENT_ENDPOINT}`, {
    method: "POST",
    headers: mpHeaders({
      "X-Idempotency-Key": randomUUID(),
    }),
    body: JSON.stringify(body),
  });

  const data = await mpResponse.json();
  if (!mpResponse.ok) {
    console.error("MP card error", data);
    throw new Error("failed_to_create_card");
  }

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

  await query("UPDATE charges SET status = $1 WHERE id = $2", [
    mapChargeStatus(providerStatus),
    charge.id,
  ]);

  return {
    charge_id: charge.id,
    provider_payment_id: data.id || null,
    status: providerStatus,
    raw: data,
  };
}

app.post("/api/charges", async (req, res) => {
  const { customer, amount, description, due_at, expires_at, public_expires_at } = req.body || {};

  if (!amount) {
    return res.status(400).json({ error: "amount is required" });
  }

  const chargeId = randomUUID();
  const status = "PENDING";

  try {
    let customerId = null;
    if (customer) {
      const docType = String(customer.docType || "").toUpperCase();
      const docNumber = String(customer.docNumber || "").trim();
      if (!customer.name || !docNumber) {
        return res.status(400).json({ error: "customer.name and customer.docNumber are required" });
      }
      customerId = randomUUID();
      const customerType = docType === "CNPJ" ? "PJ" : "PF";

      await query(
        `INSERT INTO customers (id, type, name, cpf_cnpj, email, contact)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          customerId,
          customerType,
          customer.name,
          docNumber,
          customer.email || null,
          customer.phone || null,
        ]
      );
    }

    const publicToken = randomBytes(16).toString("hex");
    const publicExpiresAt = public_expires_at || new Date(Date.now() + 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO charges (id, customer_id, amount, description, status, due_at, expires_at, public_token, public_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        chargeId,
        customerId,
        amount,
        description || null,
        status,
        due_at || null,
        expires_at || null,
        publicToken,
        publicExpiresAt,
      ]
    );

    const chargeRow = await getChargeById(chargeId);
    res.status(201).json(toClientCharge(chargeRow));
  } catch (err) {
    console.error("create charge error", err);
    res.status(500).json({ error: "failed to create charge" });
  }
});

app.get("/api/config", async (req, res) => {
  res.json({
    mpPublicKey: process.env.MP_PUBLIC_KEY || null,
  });
});

app.get("/api/charges", async (req, res) => {
  try {
    const result = await query(
      `SELECT c.*, cu.name as customer_name, cu.email as customer_email, cu.cpf_cnpj as customer_doc,
              pt.qr_code, pt.qr_code_base64
       FROM charges c
       LEFT JOIN customers cu ON cu.id = c.customer_id
       LEFT JOIN LATERAL (
         SELECT qr_code, qr_code_base64
         FROM payment_transactions pt
         WHERE pt.charge_id = c.id
         ORDER BY pt.updated_at DESC
         LIMIT 1
       ) pt ON true
       ORDER BY c.created_at DESC
       LIMIT 200`
    );

    res.json(result.rows.map(toClientCharge));
  } catch (err) {
    console.error("list charges error", err);
    res.status(500).json({ error: "failed to list charges" });
  }
});

app.get("/api/charges/:id", async (req, res) => {
  const chargeId = req.params.id;

  if (!isUuid(chargeId)) {
    return res.status(400).json({ error: "invalid charge id" });
  }

  try {
    const charge = await getChargeById(chargeId);
    if (!charge) {
      return res.status(404).json({ error: "charge not found" });
    }

    const latestTx = await getLatestPaymentTransaction(charge.id);
    if (latestTx?.provider_payment_id) {
      const mpStatusResponse = await fetch(
        `${MP_BASE_URL}${MP_PAYMENT_ENDPOINT}/${latestTx.provider_payment_id}`,
        {
          method: "GET",
          headers: mpHeaders(),
        }
      );
      const mpStatusData = await mpStatusResponse.json().catch(() => ({}));
      if (mpStatusResponse.ok) {
        const mappedStatus = mapChargeStatus(mpStatusData?.status);
        if (mappedStatus && mappedStatus !== charge.status) {
          await query("UPDATE charges SET status = $1 WHERE id = $2", [
            mappedStatus,
            charge.id,
          ]);
          charge.status = mappedStatus;
        }
      } else {
        console.error("MP status error", mpStatusData);
      }
    }

    res.json(toClientCharge(charge));
  } catch (err) {
    console.error("get charge error", err);
    res.status(500).json({ error: "failed to fetch charge" });
  }
});

app.get("/api/charges/:id/refunds", async (req, res) => {
  const chargeId = req.params.id;

  if (!isUuid(chargeId)) {
    return res.status(400).json({ error: "invalid charge id" });
  }

  try {
    const result = await query(
      `SELECT id, provider_payment_id, status, updated_at, raw_payload
       FROM payment_transactions
       WHERE charge_id = $1 AND method = 'refund'
       ORDER BY updated_at DESC`,
      [chargeId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("list refunds error", err);
    res.status(500).json({ error: "failed to list refunds" });
  }
});

app.get("/api/refunds", async (req, res) => {
  try {
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

    res.json(result.rows);
  } catch (err) {
    console.error("list all refunds error", err);
    res.status(500).json({ error: "failed to list refunds" });
  }
});

app.post("/api/charges/:id/pay/pix", async (req, res) => {
  const chargeId = req.params.id;

  if (!isUuid(chargeId)) {
    return res.status(400).json({ error: "invalid charge id" });
  }

  try {
    const charge = await getChargeById(chargeId);
    if (!charge) {
      return res.status(404).json({ error: "charge not found" });
    }

    if (charge.status === "PAID") {
      return res.status(409).json({ error: "charge already paid" });
    }

    const response = await createPixPayment(charge);
    res.json(response);
  } catch (err) {
    console.error("pay pix error", err);
    res.status(500).json({ error: "failed to create pix" });
  }
});

app.post("/api/charges/:id/pay/card", async (req, res) => {
  const chargeId = req.params.id;
  const payload = req.body || {};

  if (!isUuid(chargeId)) {
    return res.status(400).json({ error: "invalid charge id" });
  }

  try {
    const charge = await getChargeById(chargeId);
    if (!charge) {
      return res.status(404).json({ error: "charge not found" });
    }

    if (charge.status === "PAID") {
      return res.status(409).json({ error: "charge already paid" });
    }
    const response = await createCardPayment(charge, payload);
    res.json(response);
  } catch (err) {
    if (err?.message === "missing_card_token") {
      return res.status(400).json({ error: "missing card token or payment_method_id" });
    }
    console.error("pay card error", err);
    res.status(500).json({ error: "failed to create card payment" });
  }
});

app.post("/api/charges/:id/refund", async (req, res) => {
  const chargeId = req.params.id;
  const amount = req.body?.amount || null;

  if (!isUuid(chargeId)) {
    return res.status(400).json({ error: "invalid charge id" });
  }

  try {
    const charge = await getChargeById(chargeId);
    if (!charge) {
      return res.status(404).json({ error: "charge not found" });
    }

    const tx = await getLatestPaymentTransaction(chargeId);
    if (!tx?.provider_payment_id) {
      return res.status(409).json({
        error: "payment_not_found",
        message: "Nao foi encontrado pagamento para reembolso.",
      });
    }

    const mpStatusResponse = await fetch(
      `${MP_BASE_URL}${MP_PAYMENT_ENDPOINT}/${tx.provider_payment_id}`,
      {
        method: "GET",
        headers: mpHeaders(),
      }
    );

    const mpStatusData = await mpStatusResponse.json().catch(() => ({}));
    if (!mpStatusResponse.ok) {
      console.error("MP status error", mpStatusData);
      return res.status(409).json({
        error: "payment_not_approved",
        message: "Pagamento nao foi aprovado no Mercado Pago.",
        details: {
          mp_status: mpStatusData?.status || null,
          mp_status_detail: mpStatusData?.status_detail || null,
        },
      });
    }

    if (normalizePaymentStatus(mpStatusData?.status) !== "approved") {
      return res.status(409).json({
        error: "payment_not_approved",
        message: "Pagamento ainda nao foi aprovado no Mercado Pago.",
        details: {
          mp_status: mpStatusData?.status || null,
          mp_status_detail: mpStatusData?.status_detail || null,
        },
      });
    }

    const refundBody = amount ? { amount: Number(amount) } : {};
    const refundResponse = await fetch(
      `${MP_BASE_URL}${MP_PAYMENT_ENDPOINT}/${tx.provider_payment_id}/refunds`,
      {
        method: "POST",
        headers: mpHeaders({
          "X-Idempotency-Key": randomUUID(),
        }),
        body: JSON.stringify(refundBody),
      }
    );
    const refundData = await refundResponse.json().catch(() => ({}));
    if (!refundResponse.ok) {
      console.error("MP refund error", refundData);
      return res.status(409).json({
        error: "refund_not_allowed",
        message: refundData?.message || refundData?.error || "invalid refund status",
        details: refundData?.cause || null,
      });
    }

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

    await query("UPDATE charges SET status = $1 WHERE id = $2", ["CANCELED", charge.id]);
    await query("UPDATE charges SET public_expires_at = now() WHERE id = $1", [charge.id]);

    return res.json({ status: "REFUNDED", refund: refundData });
  } catch (err) {
    console.error("refund charge error", err);
    return res.status(500).json({ error: "failed to refund charge" });
  }
});

app.get("/api/public/charges/:token", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) {
    return res.status(400).json({ error: "invalid_token" });
  }

  try {
    const charge = await getChargeByPublicToken(token);
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
});

app.post("/api/public/charges/:token/pay/pix", async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!token) {
    return res.status(400).json({ error: "invalid_token" });
  }

  try {
    const charge = await getChargeByPublicToken(token);
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

    const response = await createPixPayment(charge);
    return res.json(response);
  } catch (err) {
    console.error("public pix error", err);
    return res.status(500).json({ error: "failed_to_create_pix" });
  }
});

app.post("/api/public/charges/:token/pay/card", async (req, res) => {
  const token = String(req.params.token || "").trim();
  const payload = req.body || {};
  if (!token) {
    return res.status(400).json({ error: "invalid_token" });
  }

  try {
    const charge = await getChargeByPublicToken(token);
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

    const response = await createCardPayment(charge, payload);
    return res.json(response);
  } catch (err) {
    if (err?.message === "missing_card_token") {
      return res.status(400).json({ error: "missing card token or payment_method_id" });
    }
    console.error("public card error", err);
    return res.status(500).json({ error: "failed_to_create_card" });
  }
});

app.post("/api/webhooks/mercadopago", async (req, res) => {
  return res.sendStatus(404);
});

app.post("/api/v1/webhooks/mercadopago/:secret", async (req, res) => {
  const pathSecret = req.params.secret;
  if (!MP_WEBHOOK_PATH_SECRET || pathSecret !== MP_WEBHOOK_PATH_SECRET) {
    return res.sendStatus(404);
  }

  const event = req.body || {};
  const eventId = randomUUID();
  const eventType = event.type || event.action || null;
  const externalId = event?.data?.id ? String(event.data.id) : event.id ? String(event.id) : null;
  const signatureValid = verifyMpWebhookSignature(req);

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

  if (!signatureValid) {
    return res.status(401).json({ error: "invalid webhook signature" });
  }

  res.sendStatus(200);

  if (!externalId) {
    return;
  }

  try {
    const statusResponse = await fetch(`${MP_BASE_URL}${MP_PAYMENT_ENDPOINT}/${externalId}`, {
      method: "GET",
      headers: mpHeaders(),
    });
    const paymentData = await statusResponse.json();
    if (!statusResponse.ok) {
      console.error("MP lookup error", paymentData);
      return;
    }

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

    await query("UPDATE charges SET status = $1 WHERE id = $2", [newStatus, chargeId]);

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
});

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
});
