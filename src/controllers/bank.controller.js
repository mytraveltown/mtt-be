const Bank = require("../models/bank.model");
const { BANK_DOCUMENT_TYPES } = require("../utils/documentTypes");
const { normalizeIfsc, isValidIfsc } = require("../utils/ifsc");
const { attachUploadFields, deleteStoredFile } = require("../services/media.service");

const MAX_BANK_ADDRESS_LENGTH = 500;

exports.myBankDetails = async (req, res) => {
  try {
    const bank = await Bank.findByUserId(req.user.id);

    if (!bank) {
      return res.status(404).json({
        success: false,
        message: "Bank details not found.",
      });
    }

    return res.json({
      success: true,
      data: bank,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong.",
    });
  }
};

exports.getByUserId = async (req, res) => {
  try {
    const id = req.params.id;

    const bank = await Bank.findByUserId(id);

    if (!bank) {
      return res.status(404).json({
        success: false,
        message: "Bank details not found.",
      });
    }

    return res.json({
      success: true,
      data: bank,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong.",
    });
  }
};

exports.updateBankDetails = async (req, res) => {
  try {
    const {
      bank_name,
      account_holder,
      account_name,
    } = req.body;
    const ifsc = normalizeIfsc(req.body.ifsc);
    const bankAddress = req.body.bank_address?.trim() || null;
    const documentType = req.body.bank_document_type?.trim() || null;

    // A rejected request leaves the upload unattached; S3 expires it.
    const rejectRequest = (message) => res.status(400).json({ success: false, message });

    if (bankAddress && bankAddress.length > MAX_BANK_ADDRESS_LENGTH) {
      return rejectRequest(
        `Bank address must be at most ${MAX_BANK_ADDRESS_LENGTH} characters.`
      );
    }
    if (ifsc && !isValidIfsc(ifsc)) {
      return rejectRequest(
        "Please enter a valid 11 character IFSC code (e.g. HDFC0001234)."
      );
    }

    if (documentType && !BANK_DOCUMENT_TYPES.includes(documentType)) {
      return rejectRequest(
        `bank_document_type must be one of: ${BANK_DOCUMENT_TYPES.join(", ")}`
      );
    }
    const { bank_document: uploadedPath = null } = await attachUploadFields(
      req.body,
      ["bank_document"],
      { scope: "bank-document", userId: req.user.id }
    );

    if (uploadedPath && !documentType) {
      return rejectRequest("Please select the bank document type.");
    }

    const existing = await Bank.findByUserId(req.user.id);
    if (documentType && !uploadedPath && !existing?.bank_document) {
      return rejectRequest("Please upload the bank document.");
    }

    const bank = await Bank.createOrUpdate(req.user.id, {
      bank_name,
      ifsc,
      bank_address: bankAddress,
      account_holder,
      account_name,
      bank_document_type: documentType,
      bank_document: uploadedPath,
    });

    if (uploadedPath && existing?.bank_document && existing.bank_document !== uploadedPath) {
      await deleteStoredFile(existing.bank_document);
    }

    return res.json({
      success: true,
      message: "Bank details updated successfully.",
      data: bank,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Something went wrong.",
    });
  }
};