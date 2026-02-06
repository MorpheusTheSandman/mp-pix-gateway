const { createHmac } = require("crypto");
const {
  MP_ACCESS_TOKEN,
  PUBLIC_BASE_URL,
  MP_WEBHOOK_PATH_SECRET,
  PUBLIC_APP_URL,
  MP_WEBHOOK_SECRET,
} = require("../config/env");

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

function isPublicLinkExpired(charge) {
  if (!charge?.public_expires_at) return false;
  return new Date(charge.public_expires_at).getTime() < Date.now();
}

function isChargePayable(charge) {
  return charge && charge.status === "PENDING";
}

module.exports = {
  mpHeaders,
  normalizeBaseUrl,
  webhookUrl,
  publicChargeUrl,
  isUuid,
  parseChargeId,
  mapChargeStatus,
  mapStatusForClient,
  normalizePaymentStatus,
  extractPixData,
  toClientCharge,
  pickValue,
  verifyMpWebhookSignature,
  isPublicLinkExpired,
  isChargePayable,
};
