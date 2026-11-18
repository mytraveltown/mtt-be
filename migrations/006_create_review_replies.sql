-- Replies on package reviews. Anyone can reply: logged-in users by account, guests (user_id NULL) by display name.

CREATE TABLE IF NOT EXISTS package_review_reply (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  review_id INT UNSIGNED NOT NULL,
  user_id INT NULL,
  guest_name VARCHAR(100) NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reply_review_created (review_id, created_at),
  CONSTRAINT fk_reply_review FOREIGN KEY (review_id) REFERENCES package_review (id) ON DELETE CASCADE,
  CONSTRAINT fk_reply_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
