// api/create-checkout-session.js (ESM)
// No dependencies. Uses native fetch to Stripe API.
// Required env var on Vercel:
//   STRIPE_SECRET_KEY
// Recommended:
//   SITE_URL   e.g. https://monttremblantlimoservices.com

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });

    const site =
      process.env.SITE_URL ||
      req.headers?.origin ||
      `https://${req.headers?.host}` ||
      "https://monttremblantlimoservices.com";

    const body = (req.body && typeof req.body === "object") ? req.body : {};

    const amount =
      Number(body.amount) ||
      Number(body.pay_now) ||
      Number(body.pay_now_cad) ||
      Number(body.estimate_total) ||
      Number(body.estimate_total_cad) ||
      0;

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const currency = String(body.currency || "cad").toLowerCase();
    const bookingId = String(body.booking_id || body.bookingId || "");
    const customerEmail = String(body.customer_email || body.customerEmail || body.email || "");

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
    if (bookingId) payload.append("metadata[booking_id]", bookingId);

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + secret,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    if (!r.ok) {
      return res.status(400).json({ error: "Stripe create session failed", status: r.status, details: data || text });
    }

    return res.status(200).json({ id: data.id, url: data.url });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}