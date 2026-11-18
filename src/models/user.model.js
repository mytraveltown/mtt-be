const db = require("../config/db");

class User {

    static async findByEmail(email) {
        const [[user]] = await db.query("SELECT * FROM users WHERE email=?", [
            email,
        ]);
        return user;
    }

    static async findById(id) {
        const [[user]] = await db.query("SELECT * FROM users WHERE id=?", [id]);
        return user;
    }

    static sanitize(user) {
        if (!user) return null;
        const { password, ...safeUser } = user;
        return safeUser;
    }

    static async findByPhone(phone) {
        const normalized = String(phone || "").replace(/\D/g, "");
        const last10 = normalized.slice(-10);
        if (last10.length < 10) return null;

        const [[user]] = await db.query(
            `SELECT * FROM users
             WHERE RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', ''), '(', ''), 10) = ?
             LIMIT 1`,
            [last10]
        );
        return user || null;
    }

    static async create(user) {
        const [result] = await db.query("INSERT INTO users SET ?", [user]);
        return result.insertId;
    }

    static async update(id, user) {
        const [result] = await db.query("UPDATE users SET ? WHERE id=?", [user, id]);
        return result.affectedRows;
    }

    static async delete(id) {
        const [result] = await db.query("DELETE FROM users WHERE id=?", [id]);
        return result.affectedRows;
    }

    static async updatePassword(id, password) {
        const [result] = await db.query("UPDATE users SET password=? WHERE id=?", [password, id]);
        return result.affectedRows;
    }

    static async findPaginated({ page = 1, limit = 10, search = null, role = null } = {}) {
        const safePage = Math.max(1, Number(page) || 1);
        const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
        const offset = (safePage - 1) * safeLimit;

        let where = "WHERE 1=1";
        const params = [];

        if (search) {
            where += " AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR phone LIKE ?)";
            const term = `%${search}%`;
            params.push(term, term, term, term);
        }
        if (role) {
            where += " AND role = ?";
            params.push(role);
        }

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) AS total FROM users ${where}`,
            params
        );

        const [rows] = await db.query(
            `SELECT id, name, email, phone, profile, role, age, gender, created_at, updated_at
             FROM users ${where}
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, safeLimit, offset]
        );

        return {
            data: rows.map((row) =>
                User.sanitize({
                    ...row,
                    phone: row.phone ?? row.mobile ?? null,
                })
            ),
            pagination: {
                page: safePage,
                limit: safeLimit,
                total: Number(total),
                totalPages: Math.ceil(Number(total) / safeLimit) || 1,
            },
        };
    }
}

module.exports = User;