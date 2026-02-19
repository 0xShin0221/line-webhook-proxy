// Proxy LINE webhook to OpenClaw gateway via Cloudflare Tunnel
// LINE -> Vercel (stable URL) -> Cloudflare Tunnel -> local OpenClaw

const OPENCLAW_URL = process.env.OPENCLAW_WEBHOOK_URL;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!OPENCLAW_URL) {
    console.error("OPENCLAW_WEBHOOK_URL not set");
    return res.status(500).json({ error: "Gateway URL not configured" });
  }

  const body = JSON.stringify(req.body);
  const signature = req.headers["x-line-signature"];

  try {
    const response = await fetch(OPENCLAW_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(signature ? { "x-line-signature": signature } : {}),
      },
      body,
    });

    const data = await response.text();
    return res.status(response.status).send(data);
  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(502).json({ error: "Failed to reach OpenClaw gateway" });
  }
};
