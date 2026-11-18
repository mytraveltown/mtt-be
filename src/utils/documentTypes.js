/**
 * Document types agents can choose when uploading proof documents. Placeholder values
 * for now; keep in sync with the frontend lists in src/lib/documentTypes.ts.
 */

/**
 * Agent profile: proof of the agent's company. Agents may also pick "Others" and
 * type their own document name, which is stored as-is (up to the max length).
 */
const COMPANY_DOCUMENT_TYPES = Object.freeze([
  "company_pan",
  "company_gst",
  "llpin",
  "partnership_registration",
  "msme_udyam",
]);
const CUSTOM_DOCUMENT_TYPE_MAX_LENGTH = 50;

/** Bank details: proof of the payout bank account. */
const BANK_DOCUMENT_TYPES = Object.freeze(["bank_statement", "cancelled_cheque"]);

module.exports = {
  BANK_DOCUMENT_TYPES,
  COMPANY_DOCUMENT_TYPES,
  CUSTOM_DOCUMENT_TYPE_MAX_LENGTH,
};
