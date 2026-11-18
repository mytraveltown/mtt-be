/** IFSC: 4 letters (bank code), a literal 0, then 6 alphanumeric chars (branch code). */
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const normalizeIfsc = (value) =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

const isValidIfsc = (value) => IFSC_REGEX.test(normalizeIfsc(value));

module.exports = { IFSC_REGEX, normalizeIfsc, isValidIfsc };
