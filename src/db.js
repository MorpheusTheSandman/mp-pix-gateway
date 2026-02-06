const { Pool } = require("pg");
const { DATABASE_URL } = require("./config/env");

const pool = new Pool({
  connectionString: DATABASE_URL,
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
