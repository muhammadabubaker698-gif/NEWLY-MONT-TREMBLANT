// /api/create-checkout-session.js
module.exports = async (req, res) => {
  // Basic CORS (optional but helps)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    if (!STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: "Missing env var: STRIPE_SECRET_KEY" });
    }

    // If Vercel didn’t parse JSON for some reason, this guards it
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    // Expecting cents from your frontend (e.g. 7500 for $75.00)
    const amount = Number(body.amount || body.amount_cents || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount (must be cents > 0)" });
    }

    const currency = (body.currency || "cad").toLowerCase();

    // Your domain (use your production domain)
    const baseUrl =
      process.env.BASE_URL ||
      "https://www.monttremblantlimoservices.com";

    const successUrl = `${baseUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/?payment=cancel`;

    // Stripe expects application/x-www-form-urlencoded
    const params = new URLSearchParams();

    params.append("mode", "payment");
    params.append("success_url", successUrl);
    params.append("cancel_url", cancelUrl);

    // Card payments
    params.append("payment_method_types[]", "card");

    // Line item using price_data (no Stripe Product setup needed)
    params.append("line_items[0][quantity]", "1");
    params.append("line_items[0][price_data][currency]", currency);
    params.append("line_items[0][price_data][unit_amount]", String(Math.round(amount)));
    params.append("line_items[0][price_data][product_data][name]", body.title || "Mont Tremblant Limo Booking");

    // Optional: metadata (shows in Stripe dashboard)
    if (body.bookingId) params.append("metadata[bookingId]", String(body.bookingId));
    if (body.email) params.append("customer_email", String(body.email));

    const stripeResp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await stripeResp.json();

    if (!stripeResp.ok) {
      return res.status(500).json({
        error: "Stripe error",
        details: data,
      });
    }

    // Stripe returns a hosted URL for Checkout
    return res.status(200).json({ id: data.id, url: data.url });
  } catch (err) {
    return res.status(500).json({
      error: "Server error creating Stripe checkout session",
      details: err?.message || String(err),
    });
  }
};
