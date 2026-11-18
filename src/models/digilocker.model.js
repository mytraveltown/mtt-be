const db = require("../config/db");

class DigilockerSession {
  static async create(data) {
    const [result] = await db.query("INSERT INTO digilocker_sessions SET ?", [data]);
    return result.insertId;
  }

  static async findByState(state) {
    const [[row]] = await db.query(
      "SELECT * FROM digilocker_sessions WHERE state = ? LIMIT 1",
      [state]
    );
    return row || null;
  }

  static async findLatestCompletedByUserId(userId) {
    const [[row]] = await db.query(
      `SELECT * FROM digilocker_sessions
       WHERE user_id = ? AND status = 'completed'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId]
    );
    return row || null;
  }

  static async markCompleted(id, verificationData = null) {
    const [result] = await db.query(
      "UPDATE digilocker_sessions SET status = 'completed', verification_data = ? WHERE id = ?",
      [verificationData ? JSON.stringify(verificationData) : null, id]
    );
    return result.affectedRows;
  }

  static async markFailed(id) {
    const [result] = await db.query(
      "UPDATE digilocker_sessions SET status = 'failed' WHERE id = ?",
      [id]
    );
    return result.affectedRows;
  }
}

module.exports = DigilockerSession;
