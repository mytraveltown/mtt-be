const { AiServiceError } = require("../services/ai.service");
const {
  REFINABLE_FIELDS,
  isRefinableField,
  refineText,
} = require("../services/textRefiner.service");

const MAX_INPUT_LENGTH = 20000;

exports.refineText = async (req, res) => {
  try {
    const { text, field } = req.body || {};

    if (!isRefinableField(field)) {
      return res.status(400).json({
        success: false,
        message: `field must be one of: ${REFINABLE_FIELDS.join(", ")}`,
        data: null,
      });
    }
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ success: false, message: "text is required", data: null });
    }
    if (text.length > MAX_INPUT_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `text must be ${MAX_INPUT_LENGTH} characters or fewer`,
        data: null,
      });
    }

    res.status(200).json({
      success: true,
      message: "Text refined",
      data: { text: await refineText(text, field) },
    });
  } catch (err) {
    if (err instanceof AiServiceError) {
      return res.status(err.statusCode).json({ success: false, message: err.message, data: null });
    }
    console.error("refineText error:", err);
    res.status(500).json({ success: false, message: "Failed to refine text", data: null });
  }
};
