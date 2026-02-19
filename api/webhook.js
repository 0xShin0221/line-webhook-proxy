const crypto = require("crypto");
const { kv } = require("@vercel/kv");

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAX_HISTORY = 20; // Keep last 20 messages (10 exchanges)
const HISTORY_TTL = 3600; // Expire after 1 hour of inactivity

// --- Signature validation ---

function readRawBody(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on("data", (c) => chunks.push(c));
    readable.on("end", () => resolve(Buffer.concat(chunks)));
    readable.on("error", reject);
  });
}

function validateSignature(rawBody, signature) {
  if (!signature || !CHANNEL_SECRET) return false;
  const hash = crypto
    .createHmac("SHA256", CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
}

// --- Conversation history (Vercel KV) ---

async function getHistory(userId) {
  try {
    const history = await kv.get(`line:history:${userId}`);
    return history || [];
  } catch {
    return [];
  }
}

async function saveHistory(userId, messages) {
  const trimmed = messages.slice(-MAX_HISTORY);
  try {
    await kv.set(`line:history:${userId}`, trimmed, { ex: HISTORY_TTL });
  } catch (e) {
    console.error("KV save error:", e.message);
  }
}

// --- LINE / Claude APIs ---

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

async function askClaude(messages) {
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
      system: "You are a helpful assistant on LINE messaging. Reply concisely in the user's language.",
      messages,
    }),
  });
  const data = await res.json();
  if (data.content && data.content[0]) {
    return data.content[0].text;
  }
  return "Sorry, I could not process your message.";
}

// --- Handler ---

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers["x-line-signature"];

  if (!validateSignature(rawBody, signature)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const body = JSON.parse(rawBody.toString());
  const events = body.events || [];

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;
      try {
        const history = await getHistory(userId);
        history.push({ role: "user", content: event.message.text });

        const reply = await askClaude(history);

        history.push({ role: "assistant", content: reply });
        await saveHistory(userId, history);

        await replyToLine(event.replyToken, reply);
      } catch (err) {
        console.error("Error:", err.message);
        await replyToLine(event.replyToken, "Error occurred. Please try again.");
      }
    }
  }

  return res.status(200).json({ ok: true });
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
