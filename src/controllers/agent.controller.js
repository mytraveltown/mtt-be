const fs = require("fs");
const path = require("path");
const Agent = require("../models/agent.model");
const User = require("../models/user.model");
const DigilockerSession = require("../models/digilocker.model");
const { sendMail } = require("../utils/mailer");
const { sendAgentVerifiedSms } = require("../utils/sms");
const { revokeAgent } = require("../services/delete.service");
const { remindAgentsWithoutPackages } = require("../services/agentReminder.service");
const { CUSTOM_DOCUMENT_TYPE_MAX_LENGTH } = require("../utils/documentTypes");
const { TEXT_INPUT_MAX_WORDS, countWords } = require("../utils/wordLimit");
const { prepareTextForSave } = require("../services/textRefiner.service");

// Raw input may be longer than the saved limit: prepareAboutForSave condenses it with AI.
const ABOUT_TOO_LONG_MESSAGE = `about must be ${TEXT_INPUT_MAX_WORDS} words or fewer`;

/**
 * Polishes the agent's "about" text with AI before it is saved. Skips the AI call when the text
 * is unchanged and already clean, so saving other fields does not keep re-wording the bio.
 */
const prepareAboutForSave = (about, previousAbout = null) =>
  prepareTextForSave(about, "about_me", previousAbout);

const parseDealsIn = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [value];
    } catch {
      return value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    }
  }
  return [];
};

const deleteDocument = (documentPath) => {
  if (!documentPath?.startsWith("/uploads/agents/")) return;
  const fullPath = path.join(__dirname, "../..", documentPath.replace(/^\//, ""));
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
};

// SMS is best-effort: a provider failure must never undo or fail the
// verification itself, so it is logged instead of thrown.
const notifyAgentVerified = async (agent) => {
  try {
    await sendAgentVerifiedSms(agent.user_phone);
    console.log(`[Agent verified] SMS sent -> agent #${agent.id}`);
    return true;
  } catch (err) {
    console.error(
      `[Agent verified] SMS FAILED -> agent #${agent.id}:`,
      err.response?.data?.message || err.message
    );
    return false;
  }
};

const applyVerificationUpdates = async (req, updates, existing = null) => {
  const { verification_method } = req.body;

  if (verification_method) {
    if (verification_method === "digilocker") {
      const session = await DigilockerSession.findLatestCompletedByUserId(
        req.user.id
      );
      if (!session) {
        const error = new Error("DigiLocker verification not completed");
        error.statusCode = 400;
        throw error;
      }
      updates.verification_method = "digilocker";
      updates.verification_status = "verified";
    } else if (verification_method === "upload") {
      updates.verification_method = verification_method;
      updates.verification_status = "pending";
    }
  }

  if (req.files?.aadhar?.[0]) {
    if (existing?.aadhar_document) {
      deleteDocument(existing.aadhar_document);
    }

    updates.aadhar_document = `/uploads/agents/${req.files.aadhar[0].filename}`;
    updates.verification_method = "upload";
    updates.verification_status = "pending";
  }

  if (req.files?.aadhar_back?.[0]) {
    if (existing?.aadhar_document_back) {
      deleteDocument(existing.aadhar_document_back);
    }

    updates.aadhar_document_back = `/uploads/agents/${req.files.aadhar_back[0].filename}`;
    updates.verification_method = "upload";
    updates.verification_status = "pending";
  }

  if (req.files?.dl?.[0]) {
    if (existing?.dl_document) {
      deleteDocument(existing.dl_document);
    }

    updates.dl_document = `/uploads/agents/${req.files.dl[0].filename}`;
    updates.verification_method = "upload";
    updates.verification_status = "pending";
  }

  if (req.files?.dl_back?.[0]) {
    if (existing?.dl_document_back) {
      deleteDocument(existing.dl_document_back);
    }

    updates.dl_document_back = `/uploads/agents/${req.files.dl_back[0].filename}`;
    updates.verification_method = "upload";
    updates.verification_status = "pending";
  }
};

exports.getAll = async (req, res) => {
  try {
    const agents = await Agent.findAll();
    res.status(200).json(agents);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.getManageList = async (req, res) => {
  try {
    const result = await Agent.findPaginated({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.q?.trim() || null,
      verificationStatus: req.query.verification_status || null,
    });
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.verify = async (req, res) => {
  try {
    const { verification_status } = req.body;
    const allowed = ["pending", "verified", "rejected"];

    if (!allowed.includes(verification_status)) {
      return res.status(400).json({
        message: "verification_status must be pending, verified, or rejected",
      });
    }

    const agent = await Agent.findById(req.params.id);
    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }

    await Agent.update(agent.id, { verification_status });
    const updated = await Agent.findById(agent.id);

    if (verification_status === "rejected") {
      const user = await User.findById(agent.user_id);

      if (user?.email) {
        await sendMail({
          to: user.email,
          subject: "Agent Verification Rejected - MyTravelTown",
          html: `
            <h2>Verification Rejected</h2>

            <p>Dear ${user.name || "Partner"},</p>

            <p>We reviewed your submitted verification documents, but unfortunately they could not be approved.</p>

            <p>Please log in to your MyTravelTown account, review your documents, and upload clear and valid documents again.</p>

            <p><b>Possible reasons:</b></p>
            <ul>
              <li>Blurred or unreadable document</li>
              <li>Expired document</li>
              <li>Information does not match</li>
              <li>Incomplete upload</li>
            </ul>

            <p>Once you upload new documents, our team will review them again.</p>

            <p>Regards,<br>MyTravelTown Team</p>
          `,
        });
      }
    } else if (
      verification_status === "verified" &&
      agent.verification_status !== "verified"
    ) {
      await notifyAgentVerified(updated);
    }

    res.status(200).json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const agent = await Agent.findById(req.params.id);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    res.status(200).json(agent);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.getMine = async (req, res) => {
  try {
    const agent = await Agent.findByUserId(req.user.id);
    if (!agent)
      return res.status(404).json({ message: "Agent profile not found" });
    res.status(200).json(agent);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

const parseHasCompany = (value) =>
  value === true || value === "true" || value === 1 || value === "1";

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

/**
 * Applies the company document (type + uploaded file) to `updates`.
 * A type and a file always go together: a new file needs a type, and choosing a
 * type needs a file unless one is already on record. Removing the company clears both.
 */
const applyCompanyDocument = (req, updates, hasCompany, existing = null) => {
  const uploaded = req.files?.company_document?.[0];
  const uploadedPath = uploaded ? `/uploads/agents/${uploaded.filename}` : null;
  const discardUpload = () => uploadedPath && deleteDocument(uploadedPath);

  if (!hasCompany) {
    discardUpload();
    // Only touch the columns when there is something to clear.
    if (existing?.company_document || existing?.company_document_type) {
      deleteDocument(existing.company_document);
      updates.company_document_type = null;
      updates.company_document = null;
    }
    return;
  }

  const type = req.body.company_document_type?.trim() || null;
  // Listed types or a custom name typed under "Others".
  if (type && type.length > CUSTOM_DOCUMENT_TYPE_MAX_LENGTH) {
    discardUpload();
    throw badRequest(
      `Company document type must be at most ${CUSTOM_DOCUMENT_TYPE_MAX_LENGTH} characters`
    );
  }
  if (uploadedPath && !type) {
    discardUpload();
    throw badRequest("Please select the company document type");
  }
  if (type && !uploadedPath && !existing?.company_document) {
    throw badRequest("Please upload the company document");
  }

  if (type) updates.company_document_type = type;
  if (uploadedPath) {
    if (existing?.company_document) deleteDocument(existing.company_document);
    updates.company_document = uploadedPath;
  }
};

exports.create = async (req, res) => {
  try {
    const userId = req.user.id;
    const { company_name, about, location, experience } = req.body;
    const has_company = parseHasCompany(req.body.has_company);
    const deals_in = parseDealsIn(req.body.deals_in);

    if (!about || !location || experience == null) {
      return res.status(400).json({
        message: "about, location and experience are required",
      });
    }

    if (countWords(about) > TEXT_INPUT_MAX_WORDS) {
      return res.status(400).json({ message: ABOUT_TOO_LONG_MESSAGE });
    }

    if (has_company && !company_name?.trim()) {
      return res.status(400).json({
        message: "company_name is required when you have a company",
      });
    }

    const existing = await Agent.findByUserId(userId);
    if (existing) {
      return res
        .status(400)
        .json({ message: "Agent profile already exists for this user" });
    }

    const payload = {
      user_id: userId,
      has_company,
      company_name: has_company ? company_name.trim() : "",
      about: await prepareAboutForSave(about),
      location,
      experience: Number(experience),
      deals_in,
    };

    applyCompanyDocument(req, payload, has_company);
    await applyVerificationUpdates(req, payload);

    const insertId = await Agent.create(payload);
    await User.update(userId, { role: "agent" });

    const agent = await Agent.findById(insertId);
    if (agent.verification_status === "verified") {
      await notifyAgentVerified(agent);
    }
    res.status(201).json(agent);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({
      message: err.message || "Server error",
      err: err.message,
    });
  }
};

exports.updateMine = async (req, res) => {
  try {
    const userId = req.user.id;
    const existing = await Agent.findByUserId(userId);
    if (!existing)
      return res.status(404).json({ message: "Agent profile not found" });

    const { company_name, about, location, experience } = req.body;
    if (about !== undefined && countWords(about) > TEXT_INPUT_MAX_WORDS) {
      return res.status(400).json({ message: ABOUT_TOO_LONG_MESSAGE });
    }
    const updates = {};
    const hasCompany =
      req.body.has_company !== undefined
        ? parseHasCompany(req.body.has_company)
        : Boolean(existing.has_company);
    if (req.body.has_company !== undefined) {
      updates.has_company = hasCompany;
      if (!hasCompany) {
        updates.company_name = "";
        updates.cin_no = null;
        updates.gst_no = null;
      }
    }
    if (company_name !== undefined) updates.company_name = company_name;
    applyCompanyDocument(req, updates, hasCompany, existing);
    if (about !== undefined) updates.about = await prepareAboutForSave(about, existing.about);
    if (location !== undefined) updates.location = location;
    if (experience !== undefined) updates.experience = Number(experience);
    if (req.body.deals_in !== undefined)
      updates.deals_in = parseDealsIn(req.body.deals_in);

    await applyVerificationUpdates(req, updates, existing);

    await Agent.update(existing.id, updates);

    const agent = await Agent.findByUserId(userId);
    res.status(200).json(agent);
  } catch (err) {
    console.error(err);
    res.status(err.statusCode || 500).json({
      message: err.message || "Server error",
      err: err.message,
    });
  }
};

exports.deleteMine = async (req, res) => {
  try {
    const userId = req.user.id;
    const existing = await Agent.findByUserId(userId);
    if (!existing)
      return res.status(404).json({ message: "Agent profile not found" });

    await revokeAgent(existing);
    res.status(200).json({ message: "Agent profile removed. Your account is now a regular user." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.deleteById = async (req, res) => {
  try {
    const agent = await Agent.findById(req.params.id);
    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }

    await revokeAgent(agent);
    res.status(200).json({ message: "Agent removed. User account converted to regular user." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.sendPackageReminders = async (req, res) => {
  try {
    const summary = await remindAgentsWithoutPackages();

    if (summary.total === 0) {
      return res.status(200).json({
        success: true,
        message: "Every agent has at least one package. No reminders sent.",
        data: summary,
      });
    }

    const delivered = summary.email.sent + summary.sms.sent;
    res.status(delivered > 0 ? 200 : 502).json({
      success: delivered > 0,
      message: `Reminded ${summary.total} agents without packages: ${summary.sms.sent} SMS and ${summary.email.sent} email sent.`,
      data: summary,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to send reminders", err: err.message });
  }
};
