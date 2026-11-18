const db = require("../config/db");

class LoginOtp {
  static async invalidateForUser(userId) {
    await db.query(
      "UPDATE login_otps SET verified = 1 WHERE user_id = ? AND verified = 0",
      [userId]
    );
  }

  static async create({ user_id, otp, channel, identifier, expires_at }) {
    const [result] = await db.query("INSERT INTO login_otps SET ?", [
      { user_id, otp, channel, identifier, expires_at, verified: 0 },
    ]);
    return result.insertId;
  }

  static async findValid(userId, otp) {
    const [[row]] = await db.query(
      `SELECT * FROM login_otps
       WHERE user_id = ? AND otp = ? AND verified = 0 AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, otp]
    );
    return row || null;
  }

  static async markVerified(id) {
    await db.query("UPDATE login_otps SET verified = 1 WHERE id = ?", [id]);
  }
}

module.exports = LoginOtp;
