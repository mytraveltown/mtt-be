-- The partner's bell now covers new bookings as well as reviews, so the "last opened" timestamp
-- from 010 gets a generic name. Rename only: existing values are kept.
-- Back up the `agent` table before running on production.

ALTER TABLE agent
  RENAME COLUMN review_notifications_seen_at TO notifications_seen_at;
