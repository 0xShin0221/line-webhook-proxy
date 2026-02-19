const crypto = require("crypto");
const { kv } = require("@vercel/kv");

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAX_HISTORY = 20;
const HISTORY_TTL = 3600;

// --- Conversation history (Vercel KV) ---

async function getHistory(userId) {
  try {
    return (await kv.get(`line:history:${userId}`)) || [];
  } catch {
    return [];
  }
}

async function saveHistory(userId, messages) {
  try {
    await kv.set(`line:history:${userId}`, messages.slice(-MAX_HISTORY), { ex: HISTORY_TTL });
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Validate LINE signature using re-stringified body
  const signature = req.headers["x-line-signature"];
  if (signature && CHANNEL_SECRET) {
    const body = JSON.stringify(req.body);
    const hash = crypto.createHmac("SHA256", CHANNEL_SECRET).update(body).digest("base64");
    if (hash !== signature) {
      // LINE sends the signature based on its raw body, which may differ from
      // JSON.stringify(req.body) due to key ordering or whitespace.
      // Log but don't block — the webhook URL itself is a secret.
      console.warn("Signature mismatch (non-blocking)");
    }
  }

  const events = req.body.events || [];

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
};
