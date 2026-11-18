// Phone-registered users get a placeholder address (see auth.controller) that cannot receive mail.
const PLACEHOLDER_EMAIL_PATTERN = /@mytraveltown\.local$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True for a real address we can send mail to. */
const isDeliverableEmail = (email) => {
  const value = String(email || "").trim();
  return EMAIL_PATTERN.test(value) && !PLACEHOLDER_EMAIL_PATTERN.test(value);
};

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes user-supplied text before it goes into an HTML email. */
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

module.exports = { isDeliverableEmail, escapeHtml };
