const { randomUUID, randomBytes } = require("crypto");
const { query } = require("../db");
const { toClientCharge, mapStatusForClient, publicChargeUrl } = require("../utils/helpers");

async function createCharge({ customer, amount, description, due_at, expires_at, public_expires_at }) {
  const chargeId = randomUUID();
  const status = "PENDING";
  let customerId = null;

  if (customer) {
    const docType = String(customer.docType || "").toUpperCase();
    const docNumber = String(customer.docNumber || "").trim();
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

  return getChargeById(chargeId);
}

async function listCharges() {
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

  return result.rows.map(toClientCharge);
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

async function updateChargeStatus(id, status) {
  await query("UPDATE charges SET status = $1 WHERE id = $2", [status, id]);
}

async function updateChargePublicExpiresAt(id) {
    await query("UPDATE charges SET public_expires_at = now() WHERE id = $1", [id]);
}

module.exports = {
  createCharge,
  listCharges,
  getChargeById,
  getChargeByPublicToken,
  updateChargeStatus,
  updateChargePublicExpiresAt
};
