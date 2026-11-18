const DIGILOCKER_BASE_URL =
  process.env.DIGILOCKER_API_URL || "https://verify.cgpey.com";

function getCredentials() {
  const merchantId = process.env.DIGILOCKER_MERCHANT_ID;
  const apiKey = process.env.DIGILOCKER_API_KEY;
  const secretKey = process.env.DIGILOCKER_SECRET_KEY;

  if (!merchantId || !apiKey || !secretKey) {
    const error = new Error("DigiLocker is not configured on the server");
    error.statusCode = 500;
    throw error;
  }

  return { merchantId, apiKey, secretKey };
}

function buildHeaders(credentials) {
  return {
    "Content-Type": "application/json",
    "x-merchant-id": credentials.merchantId,
    "x-api-key": credentials.apiKey,
    "x-secret-key": credentials.secretKey,
  };
}

async function parseResponse(response) {
  const text = await response.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const error = new Error(
      data.message || data.error || "DigiLocker request failed"
    );
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

exports.initiate = async ({ mobileNumber, redirectUrl }) => {
  const credentials = getCredentials();

  const response = await fetch(`${DIGILOCKER_BASE_URL}/api/v1/digilocker/initiate`, {
    method: "POST",
    headers: buildHeaders(credentials),
    body: JSON.stringify({ mobileNumber, redirectUrl }),
  });

  return parseResponse(response);
};

exports.callback = async ({ code, state, codeVerifier, recordId }) => {
  if (!codeVerifier || !state || !recordId || !code) {
    const error = new Error("Authorization code verifier, state, record ID, and code are required");
    error.statusCode = 400;
    throw error;
  }

  const response = await fetch(`${DIGILOCKER_BASE_URL}/api/v1/digilocker/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state, codeVerifier, recordId }),
  });

  return parseResponse(response);
};

exports.complete = async (recordId) => {
  if (!recordId) {
    const error = new Error("Record ID is required to complete DigiLocker verification");
    error.statusCode = 400;
    throw error;
  }

  const credentials = getCredentials();

  const response = await fetch(`${DIGILOCKER_BASE_URL}/api/v1/digilocker/complete`, {
    method: "POST",
    headers: buildHeaders(credentials),
    body: JSON.stringify({ recordId }),
  });

  return parseResponse(response);
};
