// /api/create-checkout-session.js
const Stripe = require("stripe");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    // Your index.html sends: booking_id, price_estimate, currency
    const bookingId =
      body.booking_id ||
      body.bookingId ||
      body.id ||
      body.client_reference_id;

    const amount =
      body.price_estimate ??
      body.amount ??
      body.total ??
      body.estimated_total;

    const currency = (body.currency || "CAD").toLowerCase();

    if (!bookingId) return res.status(400).json({ error: "Missing booking_id" });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Invalid price_estimate" });

    const siteUrl = process.env.SITE_URL || "https://monttremblantlimoservices.com";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency,
            product_data: { name: `Mont Tremblant Limo Booking (${bookingId})` },
            unit_amount: Math.round(Number(amount) * 100),
          },
          quantity: 1,
        },
      ],
      client_reference_id: bookingId,
      metadata: { booking_id: bookingId },
      success_url: `${siteUrl}/?paid=1&bookingId=${encodeURIComponent(bookingId)}`,
      cancel_url: `${siteUrl}/?canceled=1&bookingId=${encodeURIComponent(bookingId)}`,
    });

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (e) {
    console.error("create-checkout-session error:", e);
    return res.status(500).json({ error: e.message || "Internal error" });
  }
};
