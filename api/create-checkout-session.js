// /api/create-checkout-session.js
const Stripe = require("stripe");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // Accept BOTH: bookingId OR booking_id
    const bookingId = body.bookingId || body.booking_id;
    const amount = body.amount;
    const currency = body.currency || "CAD";

    if (!bookingId) return res.status(400).json({ error: "Missing booking_id" });
    if (!amount || Number(amount) <= 0)
      return res.status(400).json({ error: "Invalid amount" });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: String(currency).toLowerCase(),
            product_data: { name: "Mont Tremblant Limo Booking" },
            unit_amount: Math.round(Number(amount) * 100),
          },
          quantity: 1,
        },
      ],

      // Always include booking id in multiple places
      client_reference_id: bookingId,
      metadata: {
        booking_id: bookingId, // snake
        bookingId: bookingId,  // camel
      },

      success_url: `https://monttremblantlimoservices.com/?paid=1&bookingId=${encodeURIComponent(
        bookingId
      )}`,
      cancel_url: `https://monttremblantlimoservices.com/?canceled=1&bookingId=${encodeURIComponent(
        bookingId
      )}`,
    });

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
};
