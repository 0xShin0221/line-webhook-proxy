// LINE -> Vercel -> OpenClaw Agent API (via Cloudflare Tunnel) -> LINE reply
// Uses OpenClaw's full agent (memory, browser, tools) instead of direct Claude API

const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const OPENCLAW_URL = process.env.OPENCLAW_WEBHOOK_URL; // Cloudflare tunnel to gateway
const OPENCLAW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;

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

async function askOpenClaw(userId, message) {
  // Call OpenClaw Gateway RPC: agent.run
  const gatewayUrl = OPENCLAW_URL.replace(/\/api\/channels\/line\/webhook$/, "");
  const rpcUrl = `${gatewayUrl}/api/rpc`;

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(OPENCLAW_TOKEN ? { Authorization: `Bearer ${OPENCLAW_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      method: "agent.run",
      params: {
        message,
        sessionId: `line:${userId}`,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("OpenClaw RPC error:", res.status, errText);
    // Fallback: try CLI-style HTTP endpoint
    return await askOpenClawHttp(userId, message, gatewayUrl);
  }

  const data = await res.json();
  if (data.result?.payloads?.[0]?.text) {
    return data.result.payloads[0].text;
  }
  if (data.error) {
    console.error("OpenClaw error:", data.error);
    return "Sorry, an error occurred.";
  }
  return "No response from agent.";
}

async function askOpenClawHttp(userId, message, gatewayUrl) {
  // Alternative: use the agent HTTP endpoint
  const res = await fetch(`${gatewayUrl}/api/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(OPENCLAW_TOKEN ? { Authorization: `Bearer ${OPENCLAW_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      message,
      sessionId: `line:${userId}`,
    }),
  });

  if (!res.ok) {
    console.error("OpenClaw HTTP error:", res.status);
    return "Sorry, could not reach the AI agent.";
  }

  const data = await res.json();
  if (data.result?.payloads?.[0]?.text) {
    return data.result.payloads[0].text;
  }
  return data.text || "No response.";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const events = req.body.events || [];

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userId = event.source.userId;
      try {
        console.log("User:", userId, "Message:", event.message.text.slice(0, 100));
        const reply = await askOpenClaw(userId, event.message.text);
        console.log("Reply:", reply.slice(0, 200));
        await replyToLine(event.replyToken, reply);
      } catch (err) {
        console.error("Error:", err.message);
        await replyToLine(event.replyToken, "Error: " + err.message);
      }
    }
  }

  return res.status(200).json({ ok: true });
};
