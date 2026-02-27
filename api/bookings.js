// api/bookings.js
// Vercel Serverless Function (NO npm dependencies). Uses native fetch to Supabase REST.
// Env vars required on Vercel:
//  - SUPABASE_URL                 e.g. https://xxxx.supabase.co
//  - SUPABASE_SERVICE_ROLE_KEY    service_role key (server-only)
// Optional:
//  - RESEND_API_KEY, RESEND_FROM, ADMIN_NOTIFY_EMAIL (emails skipped if missing)

function readJson(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function bad(res, status, msg, extra) {
  return res.status(status).json({ ok: false, error: msg, ...extra });
}

async function sendResendEmail({ to, subject, html, bcc }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return { skipped: true };

  const payload = { from, to, subject, html };
  if (bcc) payload.bcc = bcc;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch (_) {}

  if (!r.ok) {
    return { ok: false, status: r.status, body: j || t };
  }
  return { ok: true, body: j || t };
}

module.exports = async (req, res) => {
  // Always reply JSON
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    return res.status(204).end();
  }
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") {
    return bad(res, 405, "Method not allowed");
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL) return bad(res, 500, "Missing SUPABASE_URL");
  if (!SERVICE_KEY) return bad(res, 500, "Missing SUPABASE_SERVICE_ROLE_KEY");

  try {
    const body = await readJson(req);

    // Minimal required fields (adjust if you want stricter validation)
    const required = ["mode", "pickup_text", "pickup_datetime", "currency", "vehicle_key", "price_estimate", "customer_name", "customer_email"];
    const missing = required.filter((k) => body[k] === undefined || body[k] === null || body[k] === "");
    if (missing.length) return bad(res, 400, "Missing required fields", { missing });

    // Insert booking via PostgREST
    const insertUrl = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/bookings`;
    const r = await fetch(insertUrl, {
      method: "POST",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
      },
      body: JSON.stringify(body),
    });

    const txt = await r.text();
    let data = null;
    try { data = JSON.parse(txt); } catch (_) {}

    if (!r.ok) {
      return bad(res, 400, "Supabase insert failed", { status: r.status, details: data || txt });
    }

    const inserted = Array.isArray(data) ? data[0] : data;
    const bookingId = inserted?.id;

    // Fire-and-forget-ish emails (do not block success)
    let emailWarning = null;
    try {
      const adminTo = process.env.ADMIN_NOTIFY_EMAIL;
      await sendResendEmail({
        to: body.customer_email,
        subject: "We received your booking request",
        html: `<p>Thanks! Your booking ID is <b>${bookingId || "(pending)"}</b>.</p>`,
        bcc: adminTo || undefined,
      });
      if (adminTo) {
        await sendResendEmail({
          to: adminTo,
          subject: `New booking: ${bookingId || ""}`,
          html: `<p><b>New booking</b></p><p>ID: <b>${bookingId || ""}</b></p><pre style="white-space:pre-wrap">${JSON.stringify(body, null, 2)}</pre>`,
        });
      }
    } catch (e) {
      emailWarning = e?.message || "Email failed";
    }

    return res.status(200).json({ ok: true, id: bookingId, emailWarning });
  } catch (e) {
    return bad(res, 500, e?.message || "Server error");
  }
};