const db = require("../config/db");
const { buildPaginationMeta } = require("../utils/pagination");

class Contact {
  static async findAll() {
    const [rows] = await db.query(
      "SELECT * FROM contacts ORDER BY created_at DESC"
    );
    return rows;
  }

  static async findPaginated({ page, limit, offset }) {
    const [[{ total }]] = await db.query("SELECT COUNT(*) AS total FROM contacts");
    const [rows] = await db.query(
      "SELECT * FROM contacts ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
      [limit, offset]
    );
    return {
      data: rows,
      pagination: buildPaginationMeta({ page, limit, total: Number(total) }),
    };
  }

  static async findById(id) {
    const [[row]] = await db.query("SELECT * FROM contacts WHERE id = ?", [id]);
    return row || null;
  }

  static async create(data) {
    const [result] = await db.query("INSERT INTO contacts SET ?", [data]);
    return result.insertId;
  }

  static async delete(id) {
    const [result] = await db.query("DELETE FROM contacts WHERE id = ?", [id]);
    return result.affectedRows;
  }
}

module.exports = Contact;
