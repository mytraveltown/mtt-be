-- Post-trip "rate your trip" prompt, tracked per booking so it follows the user across devices.
-- A booking becomes eligible on the last day of the trip (travel_date + package days - 1).
-- Back up the `bookings` table before running on production.

ALTER TABLE bookings
  ADD COLUMN review_prompt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN review_prompt_next_at DATETIME NULL,
  ADD COLUMN review_prompt_dismissed_at DATETIME NULL,
  ADD KEY idx_bookings_user_review_prompt (user_id, payment_status, travel_date);
