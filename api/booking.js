// Vercel Serverless Function: /api/booking
// Sends booking notifications to info@monttremblantlimoservices.com
//
// Setup (Vercel):
// 1) Create a Resend account and API key: https://resend.com
// 2) In Vercel Project Settings -> Environment Variables, add:
//    RESEND_API_KEY = <your_key>
//    BOOKING_TO_EMAIL = info@monttremblantlimoservices.com
//    BOOKING_FROM_EMAIL = bookings@monttremblantlimoservices.com   (or a verified sender in Resend)
// 3) Deploy. The booking form will POST to /api/booking
//
// If you don't have a verified sender yet, you can use "onboarding@resend.dev" temporarily.

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const payload = req.body || {};
    const to = process.env.BOOKING_TO_EMAIL || "info@monttremblantlimoservices.com";
    const from = process.env.BOOKING_FROM_EMAIL || "onboarding@resend.dev";
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ ok: false, error: "Missing RESEND_API_KEY in Vercel env vars" });
    }

    const lines = Object.entries(payload)
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join("\n");

    const subject = "New Booking Request (Website)";

    const html = `
      <div style="font-family: Inter, Arial, sans-serif; line-height:1.5">
        <h2 style="margin:0 0 12px 0">New Booking Request</h2>
        <pre style="background:#f6f7f9;padding:12px;border-radius:12px;border:1px solid #e6e8ee;white-space:pre-wrap">${escapeHtml(lines)}</pre>
        <p style="margin:12px 0 0 0;color:#555">Page: ${escapeHtml(payload._page || "")}</p>
      </div>
    `;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(502).json({ ok: false, error: text });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
