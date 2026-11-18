const db = require("../config/db");

const VALID_PAGES = ["about", "contact", "become_agent"];

class Faq {
  static isValidPage(page) {
    return VALID_PAGES.includes(page);
  }

  static async findByPage(page, { activeOnly = true } = {}) {
    if (!Faq.isValidPage(page)) return [];

    let sql = "SELECT * FROM faq WHERE page = ?";
    const params = [page];

    if (activeOnly) {
      sql += " AND is_active = 1";
    }

    sql += " ORDER BY sort_order ASC, id ASC";
    const [rows] = await db.query(sql, params);
    return rows.map(Faq.parseRow);
  }

  static async findAll({ page = null } = {}) {
    let sql = "SELECT * FROM faq WHERE 1=1";
    const params = [];

    if (page && Faq.isValidPage(page)) {
      sql += " AND page = ?";
      params.push(page);
    }

    sql += " ORDER BY page ASC, sort_order ASC, id ASC";
    const [rows] = await db.query(sql, params);
    return rows.map(Faq.parseRow);
  }

  static async findById(id) {
    const [[row]] = await db.query("SELECT * FROM faq WHERE id = ?", [id]);
    return Faq.parseRow(row);
  }

  static async create(data) {
    const [result] = await db.query("INSERT INTO faq SET ?", [data]);
    return result.insertId;
  }

  static async update(id, data) {
    const [result] = await db.query("UPDATE faq SET ? WHERE id = ?", [data, id]);
    return result.affectedRows;
  }

  static async delete(id) {
    const [result] = await db.query("DELETE FROM faq WHERE id = ?", [id]);
    return result.affectedRows;
  }

  static parseRow(row) {
    if (!row) return null;
    return {
      ...row,
      is_active: !!row.is_active,
      sort_order: Number(row.sort_order ?? 0),
    };
  }
}

module.exports = Faq;
