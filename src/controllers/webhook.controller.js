const paymentService = require("../services/payment.service");
const { verifyMpWebhookSignature } = require("../utils/helpers");
const { MP_WEBHOOK_PATH_SECRET } = require("../config/env");

async function handleMercadoPagoWebhook(req, res) {
  const pathSecret = req.params.secret;
  if (!MP_WEBHOOK_PATH_SECRET || pathSecret !== MP_WEBHOOK_PATH_SECRET) {
    return res.sendStatus(404);
  }

  const signatureValid = verifyMpWebhookSignature(req);

  if (!signatureValid) {
    // Log invalid signature but don't return 401 immediately if we want to record the event?
    // Original code: inserts event then returns 401 if invalid.
  }

  // Original code logic:
  // 1. insert webhook_event (status: received or invalid_signature)
  // 2. if !signatureValid return 401
  // 3. send 200
  // 4. process event (async)

  // I moved the insert and processing logic to paymentService.processWebhookEvent
  // But paymentService.processWebhookEvent does everything including fetching from MP.

  // Let's delegate to service, but service needs to know if signature is valid.

  // We should fire and forget the processing part after sending 200?
  // The original code uses `await` for the first insert, but then continues...
  // Wait, original code:
  // await query(INSERT...)
  // if (!valid) return 401
  // res.sendStatus(200)
  // if (!externalId) return
  // try { fetch... update... } catch...

  // So the processing happens *after* the response is sent (conceptually, although Node is single threaded, `await` yields).
  // Actually, express handler is async. If we `await` the processing, the response is delayed?
  // Original code:
  // res.sendStatus(200);
  // ... processing ...
  // This means response is sent, and then processing continues.

  // So I should trigger the processing asynchronously.

  const event = req.body || {};

  const { eventId, externalId } = await paymentService.recordWebhookEvent(event, signatureValid);

  if (!signatureValid) {
    return res.status(401).json({ error: "invalid webhook signature" });
  }

  res.sendStatus(200);

  if (externalId) {
    paymentService.processWebhookPayment(externalId, eventId).catch(err => {
        console.error("async webhook processing error", err);
    });
  }
}

module.exports = {
  handleMercadoPagoWebhook
};
