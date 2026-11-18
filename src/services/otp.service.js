const axios = require("axios");
const LoginOtp = require("../models/otp.model");

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 5;

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getExpiryDate() {
  const expires = new Date();
  expires.setMinutes(expires.getMinutes() + OTP_TTL_MINUTES);
  return expires;
}

async function sendFast2SMS(phone, otp) {
  try {
    const response = await axios.get(
      "https://www.fast2sms.com/dev/bulkV2",
      {
        params: {
          authorization: process.env.FAST2SMS_API_KEY,
          route: process.env.FAST2SMS_ROUTE || "dlt",
          sender_id: process.env.FAST2SMS_SENDER_ID,
          message: process.env.FAST2SMS_MESSAGE_ID,
          variables_values: `${otp}|`,
          numbers: phone,
        },
      }
    );

    console.log("Fast2SMS Response:", response.data);
    return response.data;
  } catch (error) {
    console.error("Fast2SMS Error:",error.response?.data || error.message);
    throw error;
  }
}

async function deliverOtp({ channel, identifier, otp, purpose = "login" }, showOnScreen) {
  const label = purpose === "reset" ? "password reset OTP" : "login OTP";
  const message = `MyTravelTown ${label}: ${otp}. Valid for ${OTP_TTL_MINUTES} minutes.`;

  if (channel === "phone") {
    console.log(`[OTP SMS -> ${identifier}] ${message} and mode is ${showOnScreen}`);
    if (!showOnScreen) {
      await sendFast2SMS(identifier, otp);
    }
    return;
  }

  console.log(`[OTP Email -> ${identifier}] ${message}`);
  // Integrate email provider (Nodemailer, SendGrid, etc.) here when configured.
}

exports.createAndSend = async ({ userId, channel, identifier, purpose = "login" }) => {
  const otp = generateOtp();
  await LoginOtp.invalidateForUser(userId);
  await LoginOtp.create({
    user_id: userId,
    otp,
    channel,
    identifier,
    expires_at: getExpiryDate(),
  });

  const showOnScreen = process.env.OTP_SHOW_ON_SCREEN === "true" || process.env.OTP_DEBUG === "true" ||
    process.env.NODE_ENV === "development";

  await deliverOtp({ channel, identifier, otp, purpose }, showOnScreen);


  return {
    expiresIn: OTP_TTL_MINUTES * 60,
    ...(showOnScreen ? { debugOtp: otp } : {}),
  };
};

exports.verify = async (userId, otp) => {
  const record = await LoginOtp.findValid(userId, otp);
  if (!record) return false;
  await LoginOtp.markVerified(record.id);
  return true;
};
