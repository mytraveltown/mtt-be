-- Bank details: one proof document (type + uploaded file) replaces the cancelled cheque upload.
-- cancelled_cheque is kept so existing agents' cheques are not lost.
-- Back up the `bank` table before running on production.

ALTER TABLE bank
  ADD COLUMN bank_document_type VARCHAR(50) NULL AFTER cancelled_cheque,
  ADD COLUMN bank_document VARCHAR(255) NULL AFTER bank_document_type;
