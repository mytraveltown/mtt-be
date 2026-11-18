const DigilockerSession = require("../models/digilocker.model");
const digilockerService = require("../services/digilocker.service");

const normalizeMobile = (value) => String(value || "").replace(/\D/g, "");

exports.initiate = async (req, res) => {
  try {
    const mobileNumber = normalizeMobile(
      req.body.mobileNumber || req.user.phone
    );

    if (mobileNumber.length < 10) {
      return res.status(400).json({ message: "Valid mobile number is required" });
    }

    const frontendUrl = (
      process.env.FRONTEND_URL || "https://mytraveltown.com"
    ).replace(/\/$/, "");
    const redirectUrl = `${frontendUrl}/agent-registration/digilocker/callback`;

    const data = await digilockerService.initiate({
      mobileNumber,
      redirectUrl,
    });

    if (!data.success) {
      return res.status(502).json({
        message: "Invalid response from DigiLocker provider",
        details: data,
      });
    }

    await DigilockerSession.create({
      user_id: req.user.id,
      record_id: data.data.recordId,
      public_id: data.data.publicId || null,
      state: data.data.state,
      status: "pending",
    });

    res.status(200).json({
      recordId: data.data.recordId,
      publicId: data.data.publicId,
      authUrl: data.data.authUrl,
      state: data.data.state,
      accountCheck: data.data.accountCheck || null,
      redirectToSignup: data.data.redirectToSignup ?? false,
    });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({
      message: err.message || "Failed to initiate DigiLocker verification",
      details: err.details,
    });
  }
};

exports.complete = async (req, res) => {
  try {
    const state = String(req.query.state || req.body.state || "").trim();
    const code = String(req.query.code || req.body.code || "").trim();
    const codeVerifier = String(
      req.query.codeVerifier || req.body.codeVerifier || ""
    ).trim();
    if (!state) {
      return res.status(400).json({ message: "Verification state is required" });
    }

    const session = await DigilockerSession.findByState(state);

    if (!session || session.user_id !== req.user.id) {
      return res.status(403).json({ message: "Invalid or expired verification session" });
    }

    if (session.status === "completed") {
      let aadhaarData = null;
      if (session.verification_data) {
        try {
          const parsed =
            typeof session.verification_data === "string"
              ? JSON.parse(session.verification_data)
              : session.verification_data;
          aadhaarData = parsed?.aadhaarData || null;
        } catch {
          /* ignore */
        }
      }

      return res.status(200).json({
        verified: true,
        recordId: session.record_id,
        aadhaarData,
        message: "DigiLocker verification already completed",
      });
    }

    const resolvedRecordId = session.record_id;

    if (!code) {
      await DigilockerSession.markFailed(session.id);
      return res.status(400).json({
        message: "Authorization code not found. Please reauthorize.",
      });
    }

    await digilockerService.callback({
      code,
      state,
      codeVerifier,
      recordId: resolvedRecordId,
    });

    const providerResult = await digilockerService.complete(resolvedRecordId);

    const verificationStatus = String(
      providerResult.data?.status || ""
    ).toUpperCase();

    if (!providerResult.success || verificationStatus !== "VERIFIED") {
      await DigilockerSession.markFailed(session.id);
      return res.status(400).json({
        message: providerResult.message || "DigiLocker verification was not completed",
        status: verificationStatus || "UNKNOWN",
        details: providerResult,
      });
    }

    const verificationData = {
      transactionId: providerResult.data?.transactionId || null,
      recordId: providerResult.data?.recordId || resolvedRecordId,
      aadhaarVerificationId: providerResult.data?.aadhaarVerificationId || null,
      service: providerResult.data?.service || null,
      status: providerResult.data?.status || null,
      aadhaarData: providerResult.data?.aadhaarData || null,
    };

    await DigilockerSession.markCompleted(session.id, verificationData);

    res.status(200).json({
      verified: true,
      recordId: resolvedRecordId,
      aadhaarData: verificationData.aadhaarData,
      message: providerResult.message || "DigiLocker verification completed successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({
      message: err.message || "Failed to complete DigiLocker verification",
      details: err.details,
    });
  }
};

exports.getStatus = async (req, res) => {
  try {
    const session = await DigilockerSession.findLatestCompletedByUserId(req.user.id);

    let aadhaarData = null;
    if (session?.verification_data) {
      try {
        const parsed =
          typeof session.verification_data === "string"
            ? JSON.parse(session.verification_data)
            : session.verification_data;
        aadhaarData = parsed?.aadhaarData || null;
      } catch {
        /* ignore */
      }
    }

    res.status(200).json({
      verified: Boolean(session),
      recordId: session?.record_id || null,
      aadhaarData,
      completedAt: session?.updated_at || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.requireCompletedSession = async (userId) => {
  const session = await DigilockerSession.findLatestCompletedByUserId(userId);
  if (!session) {
    const error = new Error("DigiLocker verification not completed");
    error.statusCode = 400;
    throw error;
  }
  return session;
};
