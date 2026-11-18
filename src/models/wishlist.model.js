const db = require("../config/db");

class Wishlist {
  static async findPackagesByUserId(userId) {
    const [rows] = await db.query(
      `SELECT p.*, a.company_name AS agent_company, u.name AS agent_name
       FROM wishlist w
       JOIN travel_package p ON p.id = w.package_id
       JOIN agent a ON a.id = p.agent_id
       JOIN users u ON u.id = a.user_id
       WHERE w.user_id = ? AND p.status = 'published'
       ORDER BY w.created_at DESC`,
      [userId]
    );
    return rows;
  }

  static async findPackageIdsByUserId(userId) {
    const [rows] = await db.query(
      "SELECT package_id FROM wishlist WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );
    return rows.map((row) => row.package_id);
  }

  static async add(userId, packageId) {
    const [result] = await db.query(
      "INSERT IGNORE INTO wishlist (user_id, package_id) VALUES (?, ?)",
      [userId, packageId]
    );
    return result.affectedRows;
  }

  static async remove(userId, packageId) {
    const [result] = await db.query(
      "DELETE FROM wishlist WHERE user_id = ? AND package_id = ?",
      [userId, packageId]
    );
    return result.affectedRows;
  }
}

module.exports = Wishlist;
