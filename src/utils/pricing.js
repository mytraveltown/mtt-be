const CONVENIENCE_FEE_PER_GUEST = Number(process.env.CONVENIENCE_FEE_PER_GUEST) || 500;
const GST_RATE = 0.05;
const ADVANCE_PERCENT = Number(process.env.BOOKING_ADVANCE_PERCENT) || 10;
/**
 * How the customer pays at booking time:
 * - "advance": ADVANCE_PERCENT now; the balance is paid later online or directly to the agent.
 * - "full": the whole amount now, nothing due later.
 */
const PAYMENT_PLANS = Object.freeze({ ADVANCE: "advance", FULL: "full" });
const isValidPaymentPlan = (plan) => Object.values(PAYMENT_PLANS).includes(plan);

const FEE_WAIVER_COUPON = (process.env.FEE_WAIVER_COUPON || "MYTRAVELTOWN").toUpperCase();

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const toPaise = (rupees) => Math.round(rupees * 100);

const normalizeCoupon = (code) => String(code || "").trim().toUpperCase();

const isValidCoupon = (code) => normalizeCoupon(code) === FEE_WAIVER_COUPON;

/**
 * Single source of truth for booking amounts.
 * The convenience fee is waived only when the fee-waiver coupon is applied.
 */
const calculateBookingPricing = ({
  unitPrice,
  guests,
  couponCode,
  paymentPlan = PAYMENT_PLANS.ADVANCE,
}) => {
  const couponApplied = isValidCoupon(couponCode);
  const basePrice = round2(Number(unitPrice) * guests);
  const convenienceFee = couponApplied ? 0 : round2(CONVENIENCE_FEE_PER_GUEST * guests);
  const gst = round2((basePrice + convenienceFee) * GST_RATE);
  const amount = round2(basePrice + convenienceFee + gst);
  const advanceAmount =
    paymentPlan === PAYMENT_PLANS.FULL ? amount : round2((amount * ADVANCE_PERCENT) / 100);
  const balanceAmount = round2(amount - advanceAmount);

  return {
    basePrice,
    convenienceFee,
    gst,
    amount,
    advanceAmount,
    balanceAmount,
    couponCode: couponApplied ? FEE_WAIVER_COUPON : null,
  };
};

module.exports = {
  ADVANCE_PERCENT,
  PAYMENT_PLANS,
  calculateBookingPricing,
  isValidPaymentPlan,
  isValidCoupon,
  normalizeCoupon,
  toPaise,
};
