const crypto = require("crypto");

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const FORWARD_URL = process.env.OPENCLAW_WEBHOOK_URL;

function validateSignature(body, signature) {
  const hash = crypto
    .createHmac("SHA256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawBody = JSON.stringify(req.body);
  const signature = req.headers["x-line-signature"];

  if (!signature || !validateSignature(rawBody, signature)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  try {
    const response = await fetch(FORWARD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-line-signature": signature,
      },
      body: rawBody,
    });

    const data = await response.text();
    return res.status(response.status).send(data);
  } catch (err) {
    console.error("Forward error:", err);
    return res.status(502).json({ error: "Failed to forward to OpenClaw" });
  }
};
