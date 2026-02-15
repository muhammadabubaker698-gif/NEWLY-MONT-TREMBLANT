const Stripe = require("stripe");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY env var" });
    }

    const stripe = Stripe(secret);

    // Vercel usually gives req.body as an object already, but sometimes it’s a string
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const {
      booking_id,
      pay_now_cad,
      currency,
      vehicle,
      triptype,
      date,
      time,
      pickup,
      dropoff,
      name,
      email
    } = body;

    const amountNumber = Number(pay_now_cad);
    if (!amountNumber || amountNumber <= 0) {
      return res.status(400).json({ error: "Invalid pay_now_cad amount" });
    }

    const unit_amount = Math.round(amountNumber * 100); // dollars -> cents
    const curr = (currency || "CAD").toLowerCase();

    // Build return URLs safely
    const origin = req.headers.origin || "https://www.monttremblantlimoservices.com";
    const success_url = `${origin}/?payment=success&booking_id=${encodeURIComponent(booking_id || "")}`;
    const cancel_url  = `${origin}/?payment=cancel&booking_id=${encodeURIComponent(booking_id || "")}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email || undefined,

      line_items: [
        {
          price_data: {
            currency: curr,
            product_data: {
              name: `Mont Tremblant Limo Booking`,
              description: `${vehicle || ""} • ${triptype || ""} • ${date || ""} ${time || ""}`.trim()
            },
            unit_amount
          },
          quantity: 1
        }
      ],

      metadata: {
        booking_id: booking_id || "",
        name: name || "",
        pickup: pickup || "",
        dropoff: dropoff || ""
      },

      success_url,
      cancel_url
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
