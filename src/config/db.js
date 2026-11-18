const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  timezone: "+05:30",

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  enableKeepAlive: true,
  keepAliveInitialDelay: 30000,
});

pool.on("connection", (connection) => {
  connection.query("SET time_zone = '+05:30'");
});

pool.on("error", (err) => {
  console.error("MySQL Pool Error:", err.code);

  if (
    err.code === "PROTOCOL_CONNECTION_LOST" ||
    err.code === "ECONNRESET"
  ) {
    console.log(
      "MySQL connection lost. Reconnecting..."
    );
  }
});

module.exports = pool;