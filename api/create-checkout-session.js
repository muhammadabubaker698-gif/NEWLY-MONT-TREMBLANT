const Stripe = require("stripe");

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method Not Allowed");
  }

  try {
    const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"), { apiVersion: "2024-06-20" });

    const body = await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        try { resolve(JSON.parse(data || "{}")); } catch (e) { reject(e); }
      });
    });

    const bookingId = body.bookingId;
    const amountCents = Number(body.amountCents);
    const currency = (body.currency || "cad").toLowerCase();

    if (!bookingId) throw new Error("Missing bookingId");
    if (!Number.isFinite(amountCents) || amountCents < 50) throw new Error("Invalid amountCents");

    const origin =
      (req.headers.origin && String(req.headers.origin)) ||
      "https://monttremblantlimoservices.com";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: bookingId,
      metadata: { booking_id: bookingId },

      line_items: [
        {
          price_data: {
            currency,
            product_data: { name: "Mont Tremblant Limo Booking" },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],

      success_url: `${origin}/?paid=1&booking_id=${encodeURIComponent(bookingId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?paid=0&booking_id=${encodeURIComponent(bookingId)}`,
    });

    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, url: session.url, id: session.id }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: e?.message || "Unknown error" }));
  }
};
