-- Bank branch address, auto-filled from the IFSC lookup (Razorpay IFSC API) on the partner Settings page.
-- Nullable so existing bank rows stay valid. Non-destructive, but back up the `bank` table before running on production.

ALTER TABLE bank
  ADD COLUMN bank_address VARCHAR(500) NULL AFTER ifsc;
