const axios = require("axios");

const FAST2SMS_URL = "https://www.fast2sms.com/dev/bulkV2";
// Keeps each bulk request comfortably small for the provider.
const SMS_BATCH_SIZE = 100;
const DEFAULT_SITE_URL = "mytraveltown.com";

const normalizePhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "").slice(-10);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
};

const sendDltSms = async ({ numbers, messageId, variables = "" }) => {
  const recipients = (Array.isArray(numbers) ? numbers : [numbers]).filter(Boolean);
  if (recipients.length === 0) {
    throw new Error("At least one phone number is required");
  }
  if (!messageId) {
    throw new Error("SMS template id is not configured");
  }

  const response = await axios.get(FAST2SMS_URL, {
    params: {
      authorization: process.env.FAST2SMS_API_KEY,
      route: process.env.FAST2SMS_ROUTE || "dlt",
      sender_id: process.env.FAST2SMS_SENDER_ID,
      message: messageId,
      variables_values: variables,
      numbers: recipients.join(","),
    },
  });

  if (response.data?.return === false) {
    throw new Error(response.data?.message || "Fast2SMS rejected the request");
  }
  // request_id is what Fast2SMS's Delivery Report dashboard is searched by.
  console.log(
    `[SMS] Accepted by Fast2SMS: template ${messageId}, ${recipients.length} number(s), request_id ${response.data?.request_id}`
  );
  return response.data;
};

const siteUrl = () => process.env.SMS_SITE_URL || DEFAULT_SITE_URL;

/** DLT template 221124: "partner profile has been successfully verified ... Login: {#VAR#}" */
const sendAgentVerifiedSms = (phone) => {
  const number = normalizePhone(phone);
  if (!number) throw new Error("Agent has no valid mobile number");
  return sendDltSms({
    numbers: number,
    messageId: process.env.FAST2SMS_VERIFIED_MESSAGE_ID,
    variables: siteUrl(),
  });
};

/**
 * DLT template 228046: "you have not listed any travel packages yet. Add your
 * first package at {#VAR#}". Sent in batches; returns the numbers that failed.
 */
const sendPackageReminderSms = async (phones) => {
  const failed = [];
  for (let i = 0; i < phones.length; i += SMS_BATCH_SIZE) {
    const batch = phones.slice(i, i + SMS_BATCH_SIZE);
    try {
      await sendDltSms({
        numbers: batch,
        messageId: process.env.FAST2SMS_REMINDER_MESSAGE_ID,
        variables: process.env.FAST2SMS_REMINDER_VARIABLES || siteUrl(),
      });
    } catch (err) {
      const error = err.response?.data?.message || err.message;
      failed.push(...batch.map((phone) => ({ phone, error })));
    }
  }
  return failed;
};

module.exports = {
  normalizePhone,
  sendDltSms,
  sendAgentVerifiedSms,
  sendPackageReminderSms,
};
