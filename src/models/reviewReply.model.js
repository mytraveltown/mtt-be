const db = require("../config/db");

const REPLY_COLUMNS = `rr.id, rr.review_id, rr.user_id, rr.comment, rr.created_at, rr.updated_at,
  COALESCE(u.name, rr.guest_name) AS user_name, u.profile AS user_profile`;

class ReviewReply {
  static async findById(id) {
    const [rows] = await db.query("SELECT * FROM package_review_reply WHERE id = ?", [id]);
    return rows[0] || null;
  }

  static async findFullById(id) {
    const [rows] = await db.query(
      `SELECT ${REPLY_COLUMNS}
       FROM package_review_reply rr
       LEFT JOIN users u ON u.id = rr.user_id
       WHERE rr.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  /** Replies for several reviews, oldest first so threads read top to bottom. */
  static async findByReviewIds(reviewIds) {
    if (!reviewIds.length) return [];
    const [rows] = await db.query(
      `SELECT ${REPLY_COLUMNS}
       FROM package_review_reply rr
       LEFT JOIN users u ON u.id = rr.user_id
       WHERE rr.review_id IN (?)
       ORDER BY rr.created_at ASC, rr.id ASC`,
      [reviewIds]
    );
    return rows;
  }

  /** `userId` is null for guest replies, which carry `guestName` instead. */
  static async create({ reviewId, userId, guestName, comment }) {
    const [result] = await db.query(
      "INSERT INTO package_review_reply (review_id, user_id, guest_name, comment) VALUES (?, ?, ?, ?)",
      [reviewId, userId, guestName, comment]
    );
    return result.insertId;
  }

  static async delete(id) {
    const [result] = await db.query("DELETE FROM package_review_reply WHERE id = ?", [id]);
    return result.affectedRows;
  }
}

module.exports = ReviewReply;
