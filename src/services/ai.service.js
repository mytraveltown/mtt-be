const axios = require("axios");

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const REQUEST_TIMEOUT_MS = 25000;

class AiServiceError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "AiServiceError";
    this.statusCode = statusCode;
  }
}

/** Primary model first, then the comma-separated fallbacks, de-duplicated. */
const getConfiguredModels = () =>
  [process.env.GEMINI_MODEL, ...(process.env.GEMINI_FALLBACK_MODELS || "").split(",")]
    .map((name) => (name || "").trim())
    .filter((name, index, all) => name && all.indexOf(name) === index);

const extractText = (data) =>
  (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();

const callModel = async (model, { systemPrompt, userPrompt }) => {
  const { data } = await axios.post(
    `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`,
    {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      // Generous token cap: newer Gemini models spend part of it on internal "thinking".
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
    },
    {
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
      timeout: REQUEST_TIMEOUT_MS,
    }
  );

  const text = extractText(data);
  if (!text) throw new Error(`Empty response from ${model}`);
  return text;
};

/**
 * Generates text with the primary Gemini model, falling back to the next configured model on failure.
 * @throws {AiServiceError} when AI is not configured or every model fails.
 */
const generateText = async (prompts) => {
  const models = getConfiguredModels();
  if (!process.env.GEMINI_API_KEY || models.length === 0) {
    throw new AiServiceError("AI text refinement is not configured", 503);
  }

  for (const model of models) {
    try {
      return await callModel(model, prompts);
    } catch (err) {
      const detail = err.response?.data?.error?.message || err.message;
      console.warn(`Gemini model ${model} failed: ${detail}`);
    }
  }
  throw new AiServiceError("AI service is temporarily unavailable. Please try again.");
};

module.exports = { generateText, AiServiceError };
