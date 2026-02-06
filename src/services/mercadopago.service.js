const { randomUUID } = require("crypto");
const { MP_BASE_URL, MP_PAYMENT_ENDPOINT } = require("../config/env");
const { mpHeaders } = require("../utils/helpers");

async function createPix(body) {
  const response = await fetch(`${MP_BASE_URL}${MP_PAYMENT_ENDPOINT}`, {
    method: "POST",
    headers: mpHeaders({
      "X-Idempotency-Key": randomUUID(),
    }),
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    const error = new Error("failed_to_create_pix");
    error.data = data;
    throw error;
  }
  return data;
}

async function createCard(body) {
  const response = await fetch(`${MP_BASE_URL}${MP_PAYMENT_ENDPOINT}`, {
    method: "POST",
    headers: mpHeaders({
      "X-Idempotency-Key": randomUUID(),
    }),
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    const error = new Error("failed_to_create_card");
    error.data = data;
    throw error;
  }
  return data;
}

async function getPayment(id) {
  const response = await fetch(`${MP_BASE_URL}${MP_PAYMENT_ENDPOINT}/${id}`, {
    method: "GET",
    headers: mpHeaders(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("failed_to_get_payment");
    error.data = data;
    throw error;
  }
  return data;
}

async function refundPayment(id, amount = null) {
  const body = amount ? { amount: Number(amount) } : {};
  const response = await fetch(`${MP_BASE_URL}${MP_PAYMENT_ENDPOINT}/${id}/refunds`, {
    method: "POST",
    headers: mpHeaders({
      "X-Idempotency-Key": randomUUID(),
    }),
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("failed_to_refund_payment");
    error.data = data;
    throw error;
  }
  return data;
}

module.exports = {
  createPix,
  createCard,
  getPayment,
  refundPayment,
};
