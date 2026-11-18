const db = require("../config/db");
const { buildPaginationMeta } = require("../utils/pagination");

class Booking {
  static baseSelect = `
    SELECT b.*,
           p.package_name,
           p.slug AS package_slug,
           p.agent_id,
           a.company_name AS agent_company,
           NULLIF(TRIM(a.gst_no), '') AS agent_gst_no,
           u.name AS user_name,
           u.phone AS agent_mobile
    FROM bookings b
    JOIN travel_package p ON p.id = b.package_id
    JOIN agent a ON a.id = p.agent_id
    JOIN users u ON u.id = a.user_id
  `;

  static async findAll() {
    const [rows] = await db.query(
      `${Booking.baseSelect} ORDER BY b.created_at DESC`
    );
    return rows;
  }

  /**
   * Builds the WHERE clause for the bookings list.
   * `dateField` picks which date the from/to range applies to: the trip date or the booking date.
   */
  static buildListFilters({ agentUserId = null, status = null, dateField = "travel", fromDate = null, toDate = null }) {
    const conditions = [];
    const params = [];
    const dateColumn = dateField === "booked" ? "b.created_at" : "b.travel_date";

    if (agentUserId) {
      conditions.push("a.user_id = ?");
      params.push(agentUserId);
    }
    if (status) {
      conditions.push("b.status = ?");
      params.push(status);
    }
    if (fromDate) {
      conditions.push(`${dateColumn} >= ?`);
      params.push(fromDate);
    }
    if (toDate) {
      // Inclusive end day without wrapping the column in DATE(), so an index can still be used.
      conditions.push(`${dateColumn} < DATE_ADD(?, INTERVAL 1 DAY)`);
      params.push(toDate);
    }

    return {
      where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
      params,
    };
  }

  /**
   * Paginated bookings. Pass `agentUserId` to restrict to one agent's bookings,
   * plus optional `status`, `dateField`, `fromDate` and `toDate` (YYYY-MM-DD) filters.
   */
  static async findPaginated({ page, limit, offset, ...filters }) {
    const { where, params } = Booking.buildListFilters(filters);

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM bookings b
       JOIN travel_package p ON p.id = b.package_id
       JOIN agent a ON a.id = p.agent_id
       ${where}`,
      params
    );

    const [rows] = await db.query(
      `${Booking.baseSelect} ${where}
       ORDER BY b.created_at DESC, b.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      data: rows,
      pagination: buildPaginationMeta({ page, limit, total: Number(total) }),
    };
  }

  static async findByUserId(userId) {
    const [rows] = await db.query(
      `${Booking.baseSelect}
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC`,
      [userId]
    );
    return rows;
  }

  static async findByAgentUserId(userId) {
    const [rows] = await db.query(
      `${Booking.baseSelect}
       WHERE a.user_id = ?
       ORDER BY b.created_at DESC`,
      [userId]
    );
    return rows;
  }

  static async findById(id) {
    const [[row]] = await db.query(`${Booking.baseSelect} WHERE b.id = ?`, [id]);
    return row || null;
  }

  static async create(data) {
    const [result] = await db.query("INSERT INTO bookings SET ?", [data]);
    return result.insertId;
  }

  /**
   * Record a successful payment at booking time and confirm the booking. A full payment
   * (no balance left) also settles the balance online.
   * Returns false when the booking was already marked paid (e.g. a duplicate callback).
   */
  static async markAdvancePaid(bookingId, paymentFields) {
    const [result] = await db.query(
      `UPDATE bookings
       SET payment_status = 'paid', payment_id = ?, razorpay_order_id = ?,
           payment_signature = ?, paid_at = ?, status = 'confirmed',
           balance_status = IF(balance_amount <= 0, 'paid', balance_status),
           balance_payment_mode = IF(balance_amount <= 0, 'platform', balance_payment_mode),
           balance_paid_at = IF(balance_amount <= 0, NOW(), balance_paid_at)
       WHERE id = ? AND payment_status <> 'paid'`,
      [
        paymentFields.payment_id,
        paymentFields.razorpay_order_id,
        paymentFields.payment_signature,
        paymentFields.paid_at,
        bookingId,
      ]
    );
    return result.affectedRows > 0;
  }

  static async setAdvanceOrderId(id, orderId) {
    await db.query("UPDATE bookings SET razorpay_order_id = ? WHERE id = ?", [orderId, id]);
  }

  static async setBalanceOrderId(id, orderId) {
    await db.query("UPDATE bookings SET balance_razorpay_order_id = ? WHERE id = ?", [
      orderId,
      id,
    ]);
  }

  static async markBalancePaid(id, { mode, paymentId = null }) {
    const [result] = await db.query(
      `UPDATE bookings
       SET balance_status = 'paid', balance_payment_mode = ?, balance_payment_id = ?, balance_paid_at = NOW()
       WHERE id = ? AND balance_status = 'pending'`,
      [mode, paymentId, id]
    );
    return result.affectedRows;
  }

  /** True when the user has a paid, non-cancelled booking for the package (used to gate reviews). */
  static async hasPaidBookingForPackage(userId, packageId) {
    const [[row]] = await db.query(
      `SELECT 1 AS booked FROM bookings
       WHERE user_id = ? AND package_id = ? AND payment_status = 'paid' AND status != 'cancelled'
       LIMIT 1`,
      [userId, packageId]
    );
    return Boolean(row);
  }

  static async updateStatus(id, status) {
    const [result] = await db.query(
      "UPDATE bookings SET status = ? WHERE id = ?",
      [status, id]
    );
    return result.affectedRows;
  }

  static async findByIdAndUpdate(id,{payment_status,payment_id,razorpay_order_id,payment_signature,paid_at , status }) {
    const [result] = await db.query(`UPDATE bookings SET payment_status = ?, payment_id = ?, razorpay_order_id = ?, payment_signature = ?, paid_at = ?, status = ? WHERE id = ?`,
      [payment_status,payment_id,razorpay_order_id,payment_signature,paid_at,status,id]
    );
    return result.affectedRows;
  }
}

module.exports = Booking;
