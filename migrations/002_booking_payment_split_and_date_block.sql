-- Booking: coupon, 10% advance / balance split, and date-block lookup index.
-- Back up the `bookings` table before running on production.

ALTER TABLE bookings
  ADD COLUMN coupon_code VARCHAR(50) NULL AFTER convenienceFee,
  ADD COLUMN advance_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN balance_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN balance_status ENUM('pending','paid') NOT NULL DEFAULT 'pending',
  ADD COLUMN balance_payment_mode ENUM('platform','agent') NULL,
  ADD COLUMN balance_razorpay_order_id VARCHAR(64) NULL,
  ADD COLUMN balance_payment_id VARCHAR(64) NULL,
  ADD COLUMN balance_paid_at DATETIME NULL,
  ADD KEY idx_bookings_package_travel (package_id, travel_date);

-- Legacy bookings were paid in full online: no balance is due.
UPDATE bookings
SET advance_amount = amount,
    balance_amount = 0,
    balance_status = 'paid',
    balance_payment_mode = 'platform'
WHERE payment_status = 'paid';
