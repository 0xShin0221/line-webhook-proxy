const crypto = require("crypto");

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function replyToLine(replyToken, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
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
  return res;
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

  // TODO: Re-enable signature validation after confirming LINE bot works
  const body = req.body;
  const events = body.events || [];

  console.log("Received events:", JSON.stringify(events).slice(0, 500));

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      try {
        console.log("User message:", event.message.text);
        const reply = await askClaude(event.message.text);
        console.log("Claude reply:", reply.slice(0, 200));
        const lineRes = await replyToLine(event.replyToken, reply);
        console.log("LINE reply status:", lineRes.status);
      } catch (err) {
        console.error("Error:", err.message);
        try {
          await replyToLine(event.replyToken, "Error occurred. Please try again.");
        } catch (e) {
          console.error("Reply error:", e.message);
        }
      }
    }
  }

  return res.status(200).json({ ok: true });
};
