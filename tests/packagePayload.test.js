const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPackagePayload } = require("../src/controllers/package.controller");

const baseBody = {
  package_name: "Bali Zen Retreat",
  from_location: "Delhi",
  to_location: "Bali",
  days: 5,
  nights: 4,
};

const international = (overrides) => buildPackagePayload({ ...baseBody, package_type: "international", ...overrides });

test("rejects an international package priced below ₹20,000", () => {
  const result = international({ price: "19999", status: "published" });
  assert.match(result.error, /at least ₹20,000/);
});

test("rejects an international draft whose price is below ₹20,000", () => {
  assert.match(international({ price: "500", status: "draft" }).error, /at least ₹20,000/);
});

test("accepts an international package priced exactly ₹20,000", () => {
  const result = international({ price: "20000", status: "published" });
  assert.equal(result.error, undefined);
  assert.equal(result.payload.price, 20000);
});

test("accepts any international price above the minimum (no maximum)", () => {
  assert.equal(international({ price: "2500000", status: "published" }).payload.price, 2500000);
});

test("requires a price before publishing an international package", () => {
  assert.match(international({ status: "published" }).error, /at least ₹20,000/);
});

test("allows an international draft to be saved without a price", () => {
  const result = international({ status: "draft" });
  assert.equal(result.error, undefined);
  assert.equal(result.payload.price, null);
});

test("does not apply the international minimum to domestic packages", () => {
  const result = buildPackagePayload({ ...baseBody, package_type: "domestic", price: "999", status: "published" });
  assert.equal(result.error, undefined);
  assert.equal(result.payload.price, 999);
});

test("rejects a price that is not a number", () => {
  assert.match(buildPackagePayload({ ...baseBody, price: "abc" }).error, /price must be a number/);
});
