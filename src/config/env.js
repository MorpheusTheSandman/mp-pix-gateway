require("dotenv").config();

module.exports = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  MP_ACCESS_TOKEN: process.env.MP_ACCESS_TOKEN,
  MP_PUBLIC_KEY: process.env.MP_PUBLIC_KEY,
  MP_BASE_URL: process.env.MP_BASE_URL || "https://api.mercadopago.com",
  MP_PAYMENT_ENDPOINT: process.env.MP_PAYMENT_ENDPOINT || "/v1/payments",
  MP_WEBHOOK_SECRET: process.env.MP_WEBHOOK_SECRET || "",
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || "",
  PUBLIC_APP_URL: process.env.PUBLIC_APP_URL || "",
  MP_WEBHOOK_PATH_SECRET: process.env.MP_WEBHOOK_PATH_SECRET || "",
};
