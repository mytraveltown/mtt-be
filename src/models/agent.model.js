const db = require("../config/db");

const DIGILOCKER_SUBQUERY = `(
  SELECT ds.verification_data
  FROM digilocker_sessions ds
  WHERE ds.user_id = a.user_id AND ds.status = 'completed'
  ORDER BY ds.updated_at DESC
  LIMIT 1
) AS digilocker_data`;

class Agent {

  static parse(agent) {
    if (!agent) return null;
    let deals_in = agent.deals_in;
    if (typeof deals_in === "string") {
      try {
        deals_in = JSON.parse(deals_in);
      } catch {
        deals_in = [];
      }
    }

    let digilocker_data = agent.digilocker_data;
    if (typeof digilocker_data === "string") {
      try {
        digilocker_data = JSON.parse(digilocker_data);
      } catch {
        digilocker_data = null;
      }
    }

    const bank =
    agent.bank_name ||
    agent.account_holder ||
    agent.account_name ||
    agent.ifsc ||
    agent.cancelled_cheque ||
    agent.bank_document
      ? {
          bank_name: agent.bank_name,
          account_holder: agent.account_holder,
          account_name: agent.account_name,
          ifsc: agent.ifsc,
          bank_address: agent.bank_address,
          cancelled_cheque: agent.cancelled_cheque,
          bank_document_type: agent.bank_document_type,
          bank_document: agent.bank_document,
        }
      : null;


    return {
      ...agent,
      bank,
      deals_in: deals_in || [],
      digilocker_data: digilocker_data || null,
    };
  }

  static async findAll() {
    const [rows] = await db.query(
      `SELECT a.*, u.name AS user_name, u.email AS user_email, u.profile AS user_profile,
         ${DIGILOCKER_SUBQUERY}
       FROM agent a
       JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC`
    );
    return rows.map(Agent.parse);
  }

  static async findPaginated({
    page = 1,
    limit = 10,
    search = null,
    verificationStatus = null,
  } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
    const offset = (safePage - 1) * safeLimit;

    let where = "WHERE 1=1";
    const params = [];

    if (search) {
      where += ` AND (
        a.company_name LIKE ?
        OR a.location LIKE ?
        OR u.name LIKE ?
        OR u.email LIKE ?
      )`;
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }
    if (verificationStatus) {
      where += " AND a.verification_status = ?";
      params.push(verificationStatus);
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM agent a
       JOIN users u ON u.id = a.user_id
       ${where}`,
      params
    );

    const [rows] = await db.query(
      `SELECT a.*, u.name AS user_name, u.email AS user_email,u.phone AS user_phone, u.profile AS user_profile, b.bank_name, b.account_holder, b.account_name, b.ifsc, b.bank_address, b.cancelled_cheque, b.bank_document_type, b.bank_document,
         ${DIGILOCKER_SUBQUERY}
       FROM agent a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN bank b ON b.user_id = a.user_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, safeLimit, offset]
    );

    return {
      data: rows.map(Agent.parse),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / safeLimit) || 1,
      },
    };
  }

  static async findWithoutPackages() {
    const [rows] = await db.query(
      `SELECT a.id, a.user_id, u.name AS user_name, u.email AS user_email, u.phone AS user_phone
       FROM agent a
       JOIN users u ON u.id = a.user_id
       WHERE NOT EXISTS (
         SELECT 1 FROM travel_package p WHERE p.agent_id = a.id
       )
       ORDER BY a.created_at DESC`
    );
    return rows;
  }

  static async findById(id) {
    const [[agent]] = await db.query(
      `SELECT a.*, u.name AS user_name, u.email AS user_email,u.phone AS user_phone, u.profile AS user_profile,
         ${DIGILOCKER_SUBQUERY}
       FROM agent a
       JOIN users u ON u.id = a.user_id
       WHERE a.id = ?`,
      [id]
    );
    return Agent.parse(agent);
  }

  static async findByUserId(userId) {
    const [[agent]] = await db.query(
      `SELECT a.*, u.name AS user_name, u.email AS user_email, u.profile AS user_profile,
         ${DIGILOCKER_SUBQUERY}
       FROM agent a
       JOIN users u ON u.id = a.user_id
       WHERE a.user_id = ?`,
      [userId]
    );
    return Agent.parse(agent);
  }

  static async create(agent) {
    const payload = {
      ...agent,
      deals_in: JSON.stringify(agent.deals_in || []),
    };
    const [result] = await db.query("INSERT INTO agent SET ?", [payload]);
    return result.insertId;
  }

  static async update(id, agent) {
    const payload = { ...agent };
    if (payload.deals_in !== undefined) {
      payload.deals_in = JSON.stringify(payload.deals_in || []);
    }
    const [result] = await db.query("UPDATE agent SET ? WHERE id=?", [
      payload,
      id,
    ]);
    return result.affectedRows;
  }
  
  static async updateByUserId(user_id, agent) {
    const payload = { ...agent };
    if (payload.deals_in !== undefined) {
      payload.deals_in = JSON.stringify(payload.deals_in || []);
    }
    const [result] = await db.query("UPDATE agent SET ? WHERE user_id=?", [
      payload,
      user_id,
    ]);
    return result.affectedRows;
  }

  static async delete(id) {
    const [result] = await db.query("DELETE FROM agent WHERE id=?", [id]);
    return result.affectedRows;
  }
}

module.exports = Agent;
