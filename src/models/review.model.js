const db = require("../config/db");
const ReviewReply = require("./reviewReply.model");

const REVIEW_COLUMNS = `r.id, r.package_id, r.user_id, r.rating, r.comment, r.created_at, r.updated_at,
  COALESCE(u.name, r.guest_name) AS user_name, u.profile AS user_profile,
  EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.user_id = r.user_id AND b.package_id = r.package_id AND b.payment_status = 'paid'
  ) AS verified`;

const toReview = (row) => ({ ...row, verified: Boolean(row.verified), media: [], replies: [] });

const groupByReviewId = (rows) => {
  const grouped = new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.review_id)) grouped.set(row.review_id, []);
    grouped.get(row.review_id).push(row);
  });
  return grouped;
};

class Review {
  static async findById(id) {
    const [rows] = await db.query("SELECT * FROM package_review WHERE id = ?", [id]);
    return rows[0] || null;
  }

  static async findByPackageId(packageId, { limit, offset }) {
    const [rows] = await db.query(
      `SELECT ${REVIEW_COLUMNS}
       FROM package_review r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.package_id = ?
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ? OFFSET ?`,
      [packageId, limit, offset]
    );
    return Review.attachDetails(rows.map(toReview));
  }

  static async findFullById(id) {
    const [rows] = await db.query(
      `SELECT ${REVIEW_COLUMNS}
       FROM package_review r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.id = ?`,
      [id]
    );
    if (!rows.length) return null;
    const [review] = await Review.attachDetails(rows.map(toReview));
    return review;
  }

  static async findByUserAndPackage(userId, packageId) {
    const [rows] = await db.query(
      `SELECT ${REVIEW_COLUMNS}
       FROM package_review r
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.user_id = ? AND r.package_id = ?`,
      [userId, packageId]
    );
    if (!rows.length) return null;
    const [review] = await Review.attachDetails(rows.map(toReview));
    return review;
  }

  /** Average rating, total count and the count for each star value (5 → 1). */
  static async getSummary(packageId) {
    const [rows] = await db.query(
      "SELECT rating, COUNT(*) AS count FROM package_review WHERE package_id = ? GROUP BY rating",
      [packageId]
    );
    const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let total = 0;
    let sum = 0;
    rows.forEach(({ rating, count }) => {
      breakdown[rating] = Number(count);
      total += Number(count);
      sum += rating * Number(count);
    });
    const average = total ? Math.round((sum / total) * 10) / 10 : 0;
    return { average, total, breakdown };
  }

  /** `userId` is null for guest reviews, which carry `guestName` instead. */
  static async create({ packageId, userId, guestName, rating, comment, media = [] }) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.query(
        "INSERT INTO package_review (package_id, user_id, guest_name, rating, comment) VALUES (?, ?, ?, ?, ?)",
        [packageId, userId, guestName, rating, comment]
      );
      if (media.length) {
        await connection.query(
          "INSERT INTO package_review_media (review_id, media_type, file_path, sort_order) VALUES ?",
          [media.map((item, index) => [result.insertId, item.media_type, item.file_path, index])]
        );
      }
      await connection.commit();
      return result.insertId;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  static async delete(id) {
    const [result] = await db.query("DELETE FROM package_review WHERE id = ?", [id]);
    return result.affectedRows;
  }

  static async getMediaByReviewId(reviewId) {
    const [rows] = await db.query(
      "SELECT * FROM package_review_media WHERE review_id = ? ORDER BY sort_order ASC, id ASC",
      [reviewId]
    );
    return rows;
  }

  /** File paths of every review media item on a package, or written by a user (for cleanup before cascading deletes). */
  static async getMediaPathsByPackageId(packageId) {
    const [rows] = await db.query(
      `SELECT m.file_path FROM package_review_media m
       JOIN package_review r ON r.id = m.review_id
       WHERE r.package_id = ?`,
      [packageId]
    );
    return rows.map((row) => row.file_path);
  }

  static async getMediaPathsByUserId(userId) {
    const [rows] = await db.query(
      `SELECT m.file_path FROM package_review_media m
       JOIN package_review r ON r.id = m.review_id
       WHERE r.user_id = ?`,
      [userId]
    );
    return rows.map((row) => row.file_path);
  }

  /** Adds `media` and `replies` arrays to each review. */
  static async attachDetails(reviews) {
    if (!reviews.length) return reviews;
    const reviewIds = reviews.map((review) => review.id);
    const [[mediaRows], replyRows] = await Promise.all([
      db.query(
        `SELECT id, review_id, media_type, file_path FROM package_review_media
         WHERE review_id IN (?)
         ORDER BY sort_order ASC, id ASC`,
        [reviewIds]
      ),
      ReviewReply.findByReviewIds(reviewIds),
    ]);
    const mediaByReview = groupByReviewId(mediaRows);
    const repliesByReview = groupByReviewId(replyRows);
    return reviews.map((review) => ({
      ...review,
      media: mediaByReview.get(review.id) || [],
      replies: repliesByReview.get(review.id) || [],
    }));
  }
}

module.exports = Review;
