const BOOKING_TIMEZONE = "Asia/Kolkata";

/**
 * Number of days blocked from today, including today. With 3, a customer on
 * 15 Oct cannot pick 15, 16 or 17 Oct; the earliest bookable date is 18 Oct.
 * Applies to every package regardless of existing bookings or payments.
 */
const BLOCKED_DAYS_FROM_TODAY = (() => {
  const value = Number(process.env.BOOKING_BLOCKED_DAYS_FROM_TODAY);
  return Number.isInteger(value) && value >= 0 ? value : 3;
})();

/** Today's date (YYYY-MM-DD) in the business timezone, independent of server TZ. */
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: BOOKING_TIMEZONE }).format(new Date());

const addDaysIso = (isoDate, days) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** First travel date a customer may book (YYYY-MM-DD). */
const earliestBookableDate = () => addDaysIso(todayIso(), BLOCKED_DAYS_FROM_TODAY);

/** ISO dates compare correctly as strings. */
const isBookableDate = (isoDate) => isoDate >= earliestBookableDate();

module.exports = {
  BLOCKED_DAYS_FROM_TODAY,
  todayIso,
  earliestBookableDate,
  isBookableDate,
};
