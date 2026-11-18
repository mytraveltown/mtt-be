const Agent = require("../models/agent.model");
const { sendMail } = require("../utils/mailer");
const { normalizePhone, sendPackageReminderSms } = require("../utils/sms");

// Phone-registered users get a placeholder email (see auth.controller), so
// those addresses must never be treated as a real inbox.
const PLACEHOLDER_EMAIL_DOMAIN = "@mytraveltown.local";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_BATCH_SIZE = 5;
const LOG_PREFIX = "[Agent reminder]";

// Keeps server logs useful for tracing without writing full contact details.
const maskTarget = (target) => {
  const value = String(target || "");
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return `${value.slice(0, 2)}******${value.slice(-2)}`;
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

const hasRealEmail = (email) =>
  Boolean(email) &&
  EMAIL_PATTERN.test(email) &&
  !email.toLowerCase().endsWith(PLACEHOLDER_EMAIL_DOMAIN);

/**
 * Every agent with a valid mobile number gets an SMS; agents who also signed
 * up with a real email (not the phone placeholder) get an email as well.
 */
const resolveChannels = (agent) => ({
  email: hasRealEmail(agent.user_email) ? agent.user_email : null,
  phone: normalizePhone(agent.user_phone),
});

const buildReminderEmail = (name) => {
  const createUrl = `${process.env.FRONTEND_URL || ""}/admin/add-listing`;
  const safeName = escapeHtml(name || "Partner");
  return {
    subject: "Create your first package on MyTravelTown",
    text: `Dear ${name || "Partner"}, your MyTravelTown agent account is ready but you have not listed any packages yet. Create your first package here: ${createUrl}`,
    html: `
      <h2>Your travellers are waiting!</h2>
      <p>Dear ${safeName},</p>
      <p>Your MyTravelTown agent account is all set, but you haven't listed any travel packages yet.</p>
      <p>Agents with live packages get discovered and booked by travellers every day. It only takes a few minutes to publish your first one.</p>
      <p><a href="${escapeHtml(createUrl)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#ffffff;border-radius:8px;text-decoration:none;">Create a package</a></p>
      <p>Regards,<br/>Team MyTravelTown</p>
    `,
  };
};

const sendEmails = async (recipients) => {
  const failed = [];
  for (let i = 0; i < recipients.length; i += EMAIL_BATCH_SIZE) {
    const batch = recipients.slice(i, i + EMAIL_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((agent) => sendMail({ to: agent.target, ...buildReminderEmail(agent.user_name) }))
    );
    results.forEach((result, index) => {
      const agent = batch[index];
      if (result.status === "rejected") {
        console.error(`${LOG_PREFIX} Email FAILED -> agent #${agent.id} (${maskTarget(agent.target)}):`, result.reason?.message);
        failed.push(agent.id);
      } else {
        console.log(`${LOG_PREFIX} Email sent -> agent #${agent.id} (${maskTarget(agent.target)})`);
      }
    });
  }
  const summary = { sent: recipients.length - failed.length, failed: failed.length };
  console.log(`${LOG_PREFIX} Emails done: ${summary.sent} sent, ${summary.failed} failed`);
  return summary;
};

const sendSms = async (recipients) => {
  if (recipients.length === 0) return { sent: 0, failed: 0, error: null };
  console.log(
    `${LOG_PREFIX} Sending SMS to ${recipients.length} agents:`,
    recipients.map((agent) => `#${agent.id} (${maskTarget(agent.target)})`).join(", ")
  );

  const failures = await sendPackageReminderSms(recipients.map((agent) => agent.target));
  failures.forEach(({ phone, error }) =>
    console.error(`${LOG_PREFIX} SMS FAILED -> ${maskTarget(phone)}:`, error)
  );

  const summary = {
    sent: recipients.length - failures.length,
    failed: failures.length,
    error: failures[0]?.error || null,
  };
  console.log(`${LOG_PREFIX} SMS done: ${summary.sent} sent, ${summary.failed} failed`);
  return summary;
};

exports.remindAgentsWithoutPackages = async () => {
  console.log(`${LOG_PREFIX} Started`);
  const agents = await Agent.findWithoutPackages();
  console.log(`${LOG_PREFIX} Agents without packages: ${agents.length}`);

  const emailRecipients = [];
  const smsRecipients = [];
  let skipped = 0;

  agents.forEach((agent) => {
    const { email, phone } = resolveChannels(agent);
    if (email) emailRecipients.push({ ...agent, target: email });
    if (phone) smsRecipients.push({ ...agent, target: phone });
    if (!email && !phone) {
      skipped += 1;
      console.warn(`${LOG_PREFIX} Skipped agent #${agent.id}: no valid email or phone`);
    }
  });

  console.log(
    `${LOG_PREFIX} Recipients -> email: ${emailRecipients.length}, sms: ${smsRecipients.length}, skipped: ${skipped}`
  );

  const [email, sms] = await Promise.all([
    sendEmails(emailRecipients),
    sendSms(smsRecipients),
  ]);

  const summary = { total: agents.length, email, sms, skipped };
  console.log(`${LOG_PREFIX} Finished:`, JSON.stringify(summary));
  return summary;
};
