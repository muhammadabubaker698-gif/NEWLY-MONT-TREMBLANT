// api/create-checkout-session.js
// Vercel Serverless Function (NO npm dependencies). Uses native fetch to Stripe API.
// Env vars required on Vercel:
//  - STRIPE_SECRET_KEY
//  - SITE_URL (optional; defaults to https://monttremblantlimoservices.com)

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
  return res.status(status).json({ error: msg, ...extra });
}

function formEncode(obj) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    params.append(k, String(v));
  }
  return params.toString();
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    return res.status(204).end();
  }
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") return bad(res, 405, "Method not allowed");

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return bad(res, 500, "Missing STRIPE_SECRET_KEY");

  const site =
    process.env.SITE_URL ||
    req.headers.origin ||
    `https://${req.headers.host}` ||
    "https://monttremblantlimoservices.com";

  try {
    const body = await readJson(req);

    const amount =
      Number(body.amount) ||
      Number(body.pay_now) ||
      Number(body.pay_now_cad) ||
      Number(body.estimate_total) ||
      Number(body.estimate_total_cad) ||
      0;

    const currency = String(body.currency || "cad").toLowerCase();
    const bookingId = String(body.booking_id || body.bookingId || "");
    const customerEmail = String(body.customer_email || body.customerEmail || body.email || "");

    if (!Number.isFinite(amount) || amount <= 0) return bad(res, 400, "Invalid amount");

    // Stripe expects form-encoded + nested keys
    const unitAmount = Math.round(amount * 100);

    const payload = new URLSearchParams();
    payload.append("mode", "payment");
    payload.append("success_url", `${site}/booking.html?payment=success&session_id={CHECKOUT_SESSION_ID}`);
    payload.append("cancel_url", `${site}/booking.html?payment=cancelled`);
    if (customerEmail) payload.append("customer_email", customerEmail);

    payload.append("line_items[0][quantity]", "1");
    payload.append("line_items[0][price_data][currency]", currency);
    payload.append("line_items[0][price_data][unit_amount]", String(unitAmount));
    payload.append("line_items[0][price_data][product_data][name]", "Mont Tremblant Limo — Booking Payment");
    if (bookingId) payload.append("line_items[0][price_data][product_data][description]", `Booking ID: ${bookingId}`);

    if (bookingId) {
      payload.append("metadata[booking_id]", bookingId);
      payload.append("metadata[bookingId]", bookingId);
    }

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(secret + ":").toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });

    const txt = await r.text();
    let data = null;
    try { data = JSON.parse(txt); } catch (_) {}

    if (!r.ok) {
      return bad(res, 400, "Stripe session create failed", { status: r.status, details: data || txt });
    }

    return res.status(200).json({ id: data.id, url: data.url });
  } catch (e) {
    return bad(res, 500, e?.message || "Server error");
  }
};