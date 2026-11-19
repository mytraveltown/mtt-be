const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareTextForSave, needsCleanup } = require("../src/services/textRefiner.service");

test("keeps an already-polished description unchanged without re-wording it", async () => {
  const saved = "A five-day tour of Bali's temples and beaches.";
  assert.equal(await prepareTextForSave(`  ${saved}  `, "location_description", saved), saved);
});

test("returns an empty string for blank text without calling the AI", async () => {
  assert.equal(await prepareTextForSave("   ", "location_description"), "");
});

test("flags text with emojis or hashtags as needing clean-up", () => {
  assert.equal(needsCleanup("Amazing trip 🌴 #bali", "location_description"), true);
  assert.equal(needsCleanup("Amazing trip to Bali.", "location_description"), false);
});

const { removeContactDetails } = require("../src/services/textRefiner.service");

const AGENT_BIO = `GaganFly Travels helps turn your travel dreams into reality.

Contact us to start planning your next adventure:
Phone: +91 9211210496 or +91 9120721114
Email: supportus@gaganfly.com`;

test("removes phone numbers, emails and the empty contact lines from an agent bio", () => {
  const cleaned = removeContactDetails(AGENT_BIO);
  assert.doesNotMatch(cleaned, /9211210496|9120721114|supportus@gaganfly\.com/);
  assert.doesNotMatch(cleaned, /Phone:|Email:/);
  assert.match(cleaned, /GaganFly Travels helps turn your travel dreams into reality\./);
});

test("needsCleanup flags text that still contains contact details", () => {
  assert.equal(needsCleanup(AGENT_BIO, "about_me"), true);
});

test("removes websites, social handles and numbers in other formats", () => {
  const cleaned = removeContactDetails(
    "Visit www.gaganfly.com or gaganfly.in, follow @gaganfly_travels, call 011-2345-6789 or (+91) 98765 43210."
  );
  assert.doesNotMatch(cleaned, /gaganfly\.(com|in)|@gaganfly_travels|2345|98765/);
});

test("removes PAN and GST numbers", () => {
  const cleaned = removeContactDetails("PAN ABCDE1234F, GSTIN 09ABCDE1234F1Z5");
  assert.doesNotMatch(cleaned, /ABCDE1234F|09ABCDE1234F1Z5/);
});

test("keeps prices, years, durations and the MyTravelTown domain", () => {
  const text = "5 days / 4 nights from ₹1,25,000 in 2026, check-in at 12:30. Book on mytraveltown.com.";
  assert.equal(removeContactDetails(text), text);
});

test("rewrites a call to action instead of leaving a gap where the number was", () => {
  assert.equal(
    removeContactDetails("Call us at +91 98765 43210 for bookings.").trim(),
    "Contact us through MyTravelTown for bookings."
  );
});

test("merges several removed details into one natural phrase", () => {
  assert.equal(
    removeContactDetails("For queries, email info@gaganfly.com or WhatsApp 9876543210.").trim(),
    "For queries, contact us through MyTravelTown."
  );
});

test("points website and social links to the MyTravelTown profile", () => {
  assert.equal(
    removeContactDetails("Follow us on Instagram @gaganfly_travels for updates.").trim(),
    "Visit our MyTravelTown profile for updates."
  );
});

test("drops a bracketed number without leaving empty brackets", () => {
  assert.equal(
    removeContactDetails("Our team (+91 9211210496) will help you with visas.").trim(),
    "Our team will help you with visas."
  );
});

test("turns a contact intro left without details into a complete sentence", () => {
  assert.equal(
    removeContactDetails(AGENT_BIO).trim().split("\n").pop(),
    "Contact us through MyTravelTown to start planning your next adventure."
  );
});

test("leaves list intros that are followed by content untouched", () => {
  const text = "Our services include:\n- Flight bookings\n- Visa assistance";
  assert.equal(removeContactDetails(text), text);
});
