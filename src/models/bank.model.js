const db = require("../config/db");

class Bank {
    static async findByUserId(userId) {
        const [rows] = await db.query(
            "SELECT * FROM bank WHERE user_id = ? LIMIT 1",
            [userId]
        );
        return rows[0] || null;
    }

    static async findById(id) {
        const [rows] = await db.query(
            "SELECT * FROM bank WHERE id = ? LIMIT 1",
            [id]
        );
        return rows[0] || null;
    }

    static async create(data) {
        const [result] = await db.query(
            `INSERT INTO bank
      (
        bank_name,
        user_id,
        ifsc,
        bank_address,
        account_holder,
        account_name,
        bank_document_type,
        bank_document
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.bank_name,
                data.user_id,
                data.ifsc,
                data.bank_address,
                data.account_holder,
                data.account_name,
                data.bank_document_type,
                data.bank_document,
            ]
        );

        return this.findById(result.insertId);
    }

    static async update(userId, data) {
        await db.query(
            `UPDATE bank
       SET
        bank_name = ?,
        ifsc = ?,
        bank_address = ?,
        account_holder = ?,
        account_name = ?,
        bank_document_type = ?,
        bank_document = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
            [
                data.bank_name,
                data.ifsc,
                data.bank_address,
                data.account_holder,
                data.account_name,
                data.bank_document_type,
                data.bank_document,
                userId,
            ]
        );

        return this.findByUserId(userId);
    }

    /** Keeps the stored document (and its type) when no new one is supplied. */
    static async createOrUpdate(userId, data) {
        const bank = await this.findByUserId(userId);

        if (bank) {
            return this.update(userId, {
                ...data,
                bank_document_type: data.bank_document_type || bank.bank_document_type,
                bank_document: data.bank_document || bank.bank_document,
            });
        }

        return this.create({
            ...data,
            user_id: userId,
        });
    }

    static async delete(userId) {
        await db.query("DELETE FROM bank WHERE user_id = ?", [userId]);
        return true;
    }
}

module.exports = Bank;