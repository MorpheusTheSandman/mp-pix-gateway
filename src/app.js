const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const hpp = require("hpp");
const rateLimit = require("express-rate-limit");
const pinoHttp = require("pino-http");
const { PUBLIC_APP_URL } = require("./config/env");

const chargesRouter = require("./routes/charges.routes");
const publicRouter = require("./routes/public.routes");
const webhookRouter = require("./routes/webhook.routes");
const refundsRouter = require("./routes/refunds.routes");
const configRouter = require("./routes/config.routes");

const app = express();

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

app.use("/api/charges", chargesRouter);
app.use("/api/public", publicRouter);
app.use("/api/refunds", refundsRouter);
app.use("/api/config", configRouter);
app.use("/api", webhookRouter); // Handles /api/webhooks... and /api/v1/webhooks...

module.exports = app;
