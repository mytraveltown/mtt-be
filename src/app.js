require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const morgan = require("morgan");
const db = require("./config/db");
const app = express();

db.getConnection()
  .then((connection) => {
    console.log(`✅ MySQL connected to ${process.env.DB_NAME} at ${process.env.DB_HOST}`);
    connection.release();
  })
  .catch((err) => {
    console.error(`❌ MySQL connection failed: ${err.code || ""} ${err.message}`);
  });

// Behind the Apache reverse proxy: use X-Forwarded-For for the client IP (rate limiting).
app.set("trust proxy", 1);

app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", require("./routes/auth.route"));
app.use("/api/users", require("./routes/user.route"));
app.use("/api/agents", require("./routes/agent.route"));
app.use("/api/packages", require("./routes/package.route"));
app.use("/api/faqs", require("./routes/faq.route"));
app.use("/api/contacts", require("./routes/contact.route"));
app.use("/api/bookings", require("./routes/booking.route"));
app.use("/api/bank", require("./routes/bank.route"));
app.use("/api/wishlist", require("./routes/wishlist.route"));
app.use("/api/reviews", require("./routes/review.route"));
app.use("/api/digilocker", require("./routes/digilocker.route"));
app.use("/api/sitemap", require("./routes/sitemap.route"));
app.use("/api/ai", require("./routes/ai.route"));

app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Local dev only: uploads missing on this machine (e.g. made on the live server) are
// redirected to MEDIA_FALLBACK_URL. Leave it unset in production.
if (process.env.MEDIA_FALLBACK_URL) {
  const fallbackBase = process.env.MEDIA_FALLBACK_URL.replace(/\/$/, "");
  app.use("/uploads", (req, res) => res.redirect(302, `${fallbackBase}/uploads${req.path}`));
}

module.exports = app;
