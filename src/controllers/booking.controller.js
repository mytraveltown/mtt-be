const Booking = require("../models/booking.model");
const { decryptId } = require("../utils/crypto");
const TravelPackage = require("../models/package.model");
const Agent = require("../models/agent.model");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const { sendMail } = require("../utils/mailer");
const { notifyAgentOfBooking } = require("../services/bookingNotification.service");
const { isPaginationRequested, parsePagination } = require("../utils/pagination");
const { encryptId } = require("../utils/crypto");
const {
  ADVANCE_PERCENT,
  PAYMENT_PLANS,
  calculateBookingPricing,
  isValidCoupon,
  isValidPaymentPlan,
  toPaise,
} = require("../utils/pricing");
const {
  BLOCKED_DAYS_FROM_TODAY,
  earliestBookableDate,
  isBookableDate,
} = require("../utils/bookingDates");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET,
});


exports.create = async (req, res) => {
  try {
    const {
      package_id,
      name,
      email,
      phone,
      address,
      travel_date,
      guests,
      coupon_code,
      payment_plan = PAYMENT_PLANS.ADVANCE,
    } = req.body;

    if (
      !package_id ||
      !name?.trim() ||
      !email?.trim() ||
      !phone?.trim() ||
      !address?.trim() ||
      !travel_date
    ) {
      return res.status(400).json({
        message:
          "package_id, name, email, phone, address, and travel_date are required",
      });
    }

    if (!DATE_PATTERN.test(String(travel_date))) {
      return res.status(400).json({ message: "travel_date must be a valid date (YYYY-MM-DD)" });
    }
    if (!isBookableDate(travel_date)) {
      return res.status(400).json({
        message: `Bookings open from ${earliestBookableDate()}. Please choose a later travel date.`,
      });
    }

    const guestCount = Number(guests) || 1;
    if (!Number.isInteger(guestCount) || guestCount < 1) {
      return res.status(400).json({ message: "At least 1 guest is required" });
    }

    if (!isValidPaymentPlan(payment_plan)) {
      return res.status(400).json({
        message: `payment_plan must be one of: ${Object.values(PAYMENT_PLANS).join(", ")}`,
      });
    }

    if (coupon_code && !isValidCoupon(coupon_code)) {
      return res.status(400).json({ message: "Invalid coupon code" });
    }

    const pkg = await TravelPackage.findFullById(package_id);
    if (!pkg || pkg.status !== "published") {
      return res.status(404).json({ message: "Package not available for booking" });
    }
    if (pkg.price == null || Number(pkg.price) <= 0) {
      return res.status(400).json({ message: "This package requires a quote from the agent" });
    }

    const pricing = calculateBookingPricing({
      unitPrice: pkg.price,
      guests: guestCount,
      couponCode: coupon_code,
      paymentPlan: payment_plan,
    });

    const insertId = await Booking.create({
      package_id: Number(package_id),
      user_id: req.user?.id || null,
      name: String(name).trim(),
      email: String(email).trim(),
      phone: String(phone).trim(),
      address: String(address).trim(),
      travel_date,
      guests: guestCount,
      basePrice: pricing.basePrice,
      convenienceFee: pricing.convenienceFee,
      coupon_code: pricing.couponCode,
      amount: pricing.amount,
      advance_amount: pricing.advanceAmount,
      balance_amount: pricing.balanceAmount,
      balance_status: "pending",
      status: "pending",
      payment_status: "pending",
    });

    let order;
    try {
      order = await razorpay.orders.create({
        amount: toPaise(pricing.advanceAmount),
        currency: "INR",
        receipt: `booking_${insertId}`,
        notes: { booking_id: String(insertId), type: payment_plan },
      });
      await Booking.setAdvanceOrderId(insertId, order.id);
    } catch (orderErr) {
      // Payment cannot start, so this booking will never be completed.
      await Booking.updateStatus(insertId, "cancelled");
      throw orderErr;
    }

    const booking = await Booking.findById(insertId);

    res.status(201).json({
      success: true,
      order,
      booking,
      key: process.env.RAZORPAY_KEY,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

/**
 * Public: dates customers cannot pick for a package. Today and the next
 * (BLOCKED_DAYS_FROM_TODAY - 1) days are blocked for every package; existing
 * bookings and payments do not block dates.
 */
exports.getBlockedDates = async (req, res) => {
  try {
    const packageId = Number(req.params.packageId);
    if (!Number.isInteger(packageId) || packageId < 1) {
      return res.status(400).json({ success: false, message: "Invalid package id" });
    }

    return res.status(200).json({
      success: true,
      message: "Blocked dates fetched",
      data: {
        blockedDaysFromToday: BLOCKED_DAYS_FROM_TODAY,
        earliestDate: earliestBookableDate(),
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

exports.verifyPayment = async (req, res) => {
  try {

    const { booking_id, razorpay_order_id, razorpay_payment_id, razorpay_signature, } = req.body;

    if (!booking_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Missing payment details."
      });
    }

    const generatedSignature = crypto.createHmac("sha256", process.env.RAZORPAY_SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed."
      });
    }

    const existing = await Booking.findById(booking_id);
    if (!existing || existing.razorpay_order_id !== razorpay_order_id) {
      return res.status(400).json({
        success: false,
        message: "Payment does not match this booking."
      });
    }
    if (existing.payment_status === "paid") {
      return res.json({ success: true, message: "Payment already verified." });
    }

    const confirmed = await Booking.markAdvancePaid(existing.id, {
      payment_id: razorpay_payment_id,
      razorpay_order_id,
      payment_signature: razorpay_signature,
      paid_at: new Date(),
    });

    if (!confirmed) {
      // A concurrent callback already recorded this payment.
      return res.json({ success: true, message: "Payment already verified." });
    }

    const booking = await Booking.findById(booking_id);
    const paidInFull = Number(booking.balance_amount) <= 0;

    // Not awaited: the traveller's confirmation should not wait on the partner's mail server.
    notifyAgentOfBooking(booking);
    const invoiceUrl = `https://mytraveltown.com/booking/${encodeURIComponent(encryptId(booking.id))}/invoice`;

    try {
      await sendMail({
        to: booking.email,
        subject: "Payment Successful - MyTravelTown",
        html: `
            <div style="font-family:Arial,sans-serif">

                <h2>Payment Successful 🎉</h2>

                <p>Dear <b>${booking.name}</b>,</p>

                <p>Your payment has been received successfully.</p>

                <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse">
                    <tr>
                        <td><b>Booking ID</b></td>
                        <td>#${booking.id}</td>
                    </tr>

                    <tr>
                        <td><b>Package</b></td>
                        <td>${booking.package_name}</td>
                    </tr>

                    <tr>
                        <td><b>${paidInFull ? "Amount Paid (full payment)" : `Amount Paid (${ADVANCE_PERCENT}% advance)`}</b></td>
                        <td>₹${booking.advance_amount}</td>
                    </tr>

                    <tr>
                        <td><b>Balance Due</b></td>
                        <td>${paidInFull ? "Nil" : `₹${booking.balance_amount}`}</td>
                    </tr>

                    <tr>
                        <td><b>Payment ID</b></td>
                        <td>${razorpay_payment_id}</td>
                    </tr>
                </table>

                <br>

                <a href="${invoiceUrl}"
                    style="
                        background:#2563eb;
                        color:#fff;
                        text-decoration:none;
                        padding:12px 24px;
                        border-radius:6px;
                        display:inline-block;
                    ">
                    View Invoice
                </a>

                <br><br>

                <p>If the button doesn't work, copy this link:</p>

                <p>${invoiceUrl}</p>

                <br>

                <p>Thank you for choosing <b>MyTravelTown</b>.</p>

            </div>
        `,
      });

    } catch (err) {
      console.error("Invoice Email Error:", err.message);
    }

    return res.json({
      success: true,
      message: "Payment verified successfully."
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error"
    });
  }
};

/** Public (invoice link holders): create a Razorpay order for the remaining balance. */
exports.createBalanceOrder = async (req, res) => {
  try {
    const bookingId = decryptId(req.params.id);
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }
    if (booking.payment_status !== "paid" || booking.status === "cancelled") {
      return res.status(400).json({ success: false, message: "Advance payment is not completed" });
    }
    if (booking.balance_status === "paid" || Number(booking.balance_amount) <= 0) {
      return res.status(400).json({ success: false, message: "No balance is due" });
    }

    const order = await razorpay.orders.create({
      amount: toPaise(Number(booking.balance_amount)),
      currency: "INR",
      receipt: `balance_${booking.id}_${Date.now()}`,
      notes: { booking_id: String(booking.id), type: "balance" },
    });
    await Booking.setBalanceOrderId(booking.id, order.id);

    return res.status(201).json({
      success: true,
      message: "Balance order created",
      data: { order, booking, key: process.env.RAZORPAY_KEY },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

exports.verifyBalancePayment = async (req, res) => {
  try {
    const { booking_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!booking_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: "Missing payment details." });
    }

    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");
    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Payment verification failed." });
    }

    const booking = await Booking.findById(booking_id);
    if (!booking || booking.balance_razorpay_order_id !== razorpay_order_id) {
      return res.status(400).json({ success: false, message: "Payment does not match this booking." });
    }

    await Booking.markBalancePaid(booking.id, {
      mode: "platform",
      paymentId: razorpay_payment_id,
    });

    return res.json({ success: true, message: "Balance payment verified successfully." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

/** Agent/admin: record that the customer paid the balance directly to the agent. */
exports.markBalanceReceivedByAgent = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    if (req.user.role === "agent") {
      const agent = await Agent.findByUserId(req.user.id);
      if (!agent || booking.agent_id !== agent.id) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    if (booking.payment_status !== "paid") {
      return res.status(400).json({ success: false, message: "Advance payment is not completed" });
    }

    const changed = await Booking.markBalancePaid(booking.id, { mode: "agent" });
    if (!changed) {
      return res.status(400).json({ success: false, message: "Balance is already settled" });
    }

    const updated = await Booking.findById(booking.id);
    return res.status(200).json({ success: true, message: "Balance marked as received", data: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

exports.getAll = async (req, res) => {
  try {
    const bookings = await Booking.findAll();
    res.status(200).json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.getMine = async (req, res) => {
  try {
    const bookings = await Booking.findByUserId(req.user.id);
    res.status(200).json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const bookingId = decryptId(req.params.id);
    console.log(bookingId);
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    return res.status(200).json(booking);
    if (req.user.role === "admin") {
    }

    if (booking.user_id === req.user.id) {
      return res.status(200).json(booking);
    }

    if (req.user.role === "agent") {
      const agent = await Agent.findByUserId(req.user.id);
      if (agent && booking.agent_id === agent.id) {
        return res.status(200).json(booking);
      }
    }

    return res.status(403).json({ message: "Access denied" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

const BOOKING_STATUSES = ["pending", "confirmed", "cancelled"];
const BOOKING_DATE_FIELDS = ["travel", "booked"];
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Rejects malformed and impossible dates such as 2026-02-31. */
const isValidIsoDate = (value) => {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** Validates the optional list filters from the query string. Returns `{ error }` or `{ filters }`. */
const parseBookingListFilters = (query) => {
  const status = query.status ? String(query.status) : null;
  const dateField = query.dateField ? String(query.dateField) : "travel";
  const fromDate = query.from ? String(query.from) : null;
  const toDate = query.to ? String(query.to) : null;

  if (status && !BOOKING_STATUSES.includes(status)) {
    return { error: "status must be pending, confirmed, or cancelled" };
  }
  if (!BOOKING_DATE_FIELDS.includes(dateField)) {
    return { error: "dateField must be travel or booked" };
  }
  if ((fromDate && !isValidIsoDate(fromDate)) || (toDate && !isValidIsoDate(toDate))) {
    return { error: "from and to must be dates in YYYY-MM-DD format" };
  }
  if (fromDate && toDate && fromDate > toDate) {
    return { error: "from date cannot be after to date" };
  }

  return { filters: { status, dateField, fromDate, toDate } };
};

// GET /api/bookings/manage?page=&limit=&status=&dateField=travel|booked&from=YYYY-MM-DD&to=YYYY-MM-DD
exports.getManage = async (req, res) => {
  try {
    const paginate = isPaginationRequested(req.query);
    const paging = paginate ? parsePagination(req.query) : null;

    const parsedFilters = parseBookingListFilters(req.query);
    if (parsedFilters.error) {
      return res.status(400).json({ message: parsedFilters.error });
    }
    const { filters } = parsedFilters;

    if (req.user.role === "admin") {
      if (paginate) {
        return res.status(200).json(await Booking.findPaginated({ ...paging, ...filters }));
      }
      const bookings = await Booking.findAll();
      return res.status(200).json(bookings);
    }

    const agent = await Agent.findByUserId(req.user.id);
    if (!agent) {
      return res.status(404).json({ message: "Agent profile not found" });
    }

    if (paginate) {
      return res
        .status(200)
        .json(await Booking.findPaginated({ ...paging, ...filters, agentUserId: req.user.id }));
    }

    const bookings = await Booking.findByAgentUserId(req.user.id);
    res.status(200).json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["pending", "confirmed", "cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        message: "status must be pending, confirmed, or cancelled",
      });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (req.user.role === "agent") {
      const agent = await Agent.findByUserId(req.user.id);
      if (!agent || booking.agent_id !== agent.id) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    await Booking.updateStatus(booking.id, status);
    const updated = await Booking.findById(booking.id);
    res.status(200).json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};
