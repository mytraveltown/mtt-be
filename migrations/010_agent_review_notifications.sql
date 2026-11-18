-- Review notifications for travel partners: a review on one of the agent's packages is "unread"
-- until the agent opens the notification bell, which moves this timestamp forward.
-- NULL means the agent has never opened the bell, so every review counts as unread.
-- Back up the `agent` table before running on production.

ALTER TABLE agent
  ADD COLUMN review_notifications_seen_at DATETIME NULL;

-- No new index needed: idx_review_package_created (package_id, created_at) from 005 covers the lookup.
