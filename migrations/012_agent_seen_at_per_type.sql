-- Bookings and reviews are now marked read separately: opening the Bookings page clears the
-- booking count without touching reviews. Keeps existing values: the shared timestamp becomes
-- the reviews one and seeds the new bookings one.
-- Back up the `agent` table before running on production.

ALTER TABLE agent
  RENAME COLUMN notifications_seen_at TO reviews_seen_at,
  ADD COLUMN bookings_seen_at DATETIME NULL AFTER reviews_seen_at;

UPDATE agent SET bookings_seen_at = reviews_seen_at WHERE reviews_seen_at IS NOT NULL;
