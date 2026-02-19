const crypto = require("crypto");

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function validateSignature(body, signature) {
  const hash = crypto
    .createHmac("SHA256", CHANNEL_SECRET)
    .update(Buffer.from(body))
    .digest("base64");
  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(signature)
  );
}

async function replyToLine(replyToken, text) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: text.slice(0, 5000) }],
    }),
  });
}

async function askClaude(userMessage) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  const data = await res.json();
  if (data.content && data.content[0]) {
    return data.content[0].text;
  }
  return "Sorry, I could not process your message.";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Vercel provides raw body as string via x-vercel-raw-body or we can use req.body
  const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  const signature = req.headers["x-line-signature"];

  if (!signature) {
    return res.status(401).json({ error: "No signature" });
  }

  try {
    if (!validateSignature(rawBody, signature)) {
      return res.status(401).json({ error: "Invalid signature" });
    }
  } catch (e) {
    return res.status(401).json({ error: "Signature validation error" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const events = body.events || [];

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      try {
        const reply = await askClaude(event.message.text);
        await replyToLine(event.replyToken, reply);
      } catch (err) {
        console.error("Error:", err);
        await replyToLine(event.replyToken, "Error occurred. Please try again.");
      }
    }
  }

  return res.status(200).json({ ok: true });
};
