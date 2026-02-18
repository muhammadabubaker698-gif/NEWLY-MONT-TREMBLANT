// api/create-checkout-session.js
const Stripe = require("stripe");

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"));

    // Vercel sometimes gives string body
    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body || {};

    // ✅ Support BOTH booking id names
    const bookingId = body.bookingId || body.booking_id;

    // ✅ Accept ANY price field your frontend sends
    const amount =
      body.amount ??
      body.pay_now ??
      body.pay_now_cad ??
      body.estimate_total ??
      body.estimate_total_cad ??
      body.price_estimate ??
      null;

    // Default CAD
    const currency = (body.currency || "CAD").toString().toLowerCase();

    if (!bookingId) {
      return res.status(400).json({ error: "Missing booking id" });
    }

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Convert dollars → cents
    const unitAmount = Math.round(Number(amount) * 100);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],

      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: "Mont Tremblant Limo Booking",
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],

      // VERY IMPORTANT for webhook booking match
      client_reference_id: bookingId,
      metadata: {
        booking_id: bookingId,
        bookingId: bookingId,
      },

      success_url:
        "https://monttremblantlimoservices.com/?paid=1&bookingId=" +
        encodeURIComponent(bookingId),

      cancel_url:
        "https://monttremblantlimoservices.com/?canceled=1&bookingId=" +
        encodeURIComponent(bookingId),
    });

    return res.status(200).json({
      url: session.url,
      id: session.id,
    });

  } catch (err) {
    console.error("Stripe session error:", err);
    return res.status(500).json({
      error: err.message || "Stripe session failed",
    });
  }
};
