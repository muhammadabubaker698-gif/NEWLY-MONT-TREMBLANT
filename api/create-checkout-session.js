// /api/create-checkout-session.js
const Stripe = require("stripe");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const { bookingId, amount, currency } = body;

    if (!bookingId) throw new Error("Missing bookingId");
    if (!amount || amount <= 0) throw new Error("Invalid amount");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: (currency || "CAD").toLowerCase(),
            product_data: { name: "Mont Tremblant Limo Booking" },
            unit_amount: Math.round(Number(amount) * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `https://monttremblantlimoservices.com/?paid=1&bookingId=${bookingId}`,
      cancel_url: `https://monttremblantlimoservices.com/?canceled=1&bookingId=${bookingId}`,

      // IMPORTANT:
      client_reference_id: bookingId,
      metadata: { bookingId },
    });

    res.status(200).json({ url: session.url, id: session.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
