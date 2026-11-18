const Agent = require("../models/agent.model");
const { sendMail } = require("../utils/mailer");
const { isDeliverableEmail, escapeHtml } = require("../utils/email");

const formatInr = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const formatDate = (value) =>
  new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const row = (label, value) =>
  `<tr><td style="padding:8px 12px;color:#64748b">${label}</td><td style="padding:8px 12px"><b>${value}</b></td></tr>`;

const buildAgentBookingEmail = (booking, agentName) => {
  const paidInFull = Number(booking.balance_amount) <= 0;
  const dashboardUrl = `${process.env.FRONTEND_URL || "https://mytraveltown.com"}/admin/bookings`;
  const customerEmail = isDeliverableEmail(booking.email) ? escapeHtml(booking.email) : null;

  const subject = `New booking #${booking.id}: ${booking.package_name}`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#0f172a;max-width:560px">
      <h2 style="margin:0 0 8px">You have a new booking</h2>
      <p>Hi <b>${escapeHtml(agentName)}</b>, a traveller has booked and paid for your package.</p>
      <table cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;width:100%">
        ${row("Booking ID", `#${booking.id}`)}
        ${row("Package", escapeHtml(booking.package_name))}
        ${row("Travel date", formatDate(booking.travel_date))}
        ${row("Guests", Number(booking.guests))}
        ${row("Customer", escapeHtml(booking.name))}
        ${row("Phone", escapeHtml(booking.phone))}
        ${customerEmail ? row("Email", customerEmail) : ""}
        ${row("Total", formatInr(booking.amount))}
        ${row("Paid online", formatInr(booking.advance_amount))}
        ${row("Balance due", paidInFull ? "Nil" : formatInr(booking.balance_amount))}
      </table>
      <p style="margin-top:20px">Please contact the traveller to confirm the trip details.</p>
      <a href="${dashboardUrl}"
         style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block">
        View booking
      </a>
      <p style="margin-top:24px;color:#64748b">MyTravelTown</p>
    </div>`;

  const text = [
    `New booking #${booking.id} for ${booking.package_name}`,
    `Travel date: ${formatDate(booking.travel_date)}, guests: ${booking.guests}`,
    `Customer: ${booking.name}, phone: ${booking.phone}${customerEmail ? `, email: ${booking.email}` : ""}`,
    `Total ${formatInr(booking.amount)}, paid ${formatInr(booking.advance_amount)}, balance ${paidInFull ? "nil" : formatInr(booking.balance_amount)}`,
    `View it at ${dashboardUrl}`,
  ].join("\n");

  return { subject, html, text };
};

/**
 * Emails the travel partner about a confirmed booking. Partners without a real email
 * (phone sign-ups get a placeholder) are skipped; they still see it in the dashboard bell.
 * Never throws: a mail failure must not affect the traveller's payment confirmation.
 */
const notifyAgentOfBooking = async (booking) => {
  try {
    const agent = await Agent.findById(booking.agent_id);
    if (!agent || !isDeliverableEmail(agent.user_email)) return { sent: false, reason: "no_email" };

    await sendMail({ to: agent.user_email, ...buildAgentBookingEmail(booking, agent.user_name) });
    return { sent: true };
  } catch (err) {
    console.error(`Agent booking email failed for booking #${booking.id}:`, err.message);
    return { sent: false, reason: "error" };
  }
};

module.exports = { notifyAgentOfBooking, buildAgentBookingEmail };
