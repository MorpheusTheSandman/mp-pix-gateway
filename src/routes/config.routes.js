const express = require("express");
const router = express.Router();
const { MP_PUBLIC_KEY } = require("../config/env");

router.get("/", (req, res) => {
  res.json({
    mpPublicKey: MP_PUBLIC_KEY || null,
  });
});

module.exports = router;
