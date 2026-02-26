import Stripe from "stripe";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    console.log("Stripe request body:", body);

    // Accept ALL possible frontend formats
    const amount =
      Number(body.pay_now) ||
      Number(body.pay_now_cad) ||
      Number(body.amount) ||
      Number(body.estimate_total) ||
      Number(body.estimate_total_cad);

    if (!amount || amount <= 0) {
      return res.status(400).json({
        error: "Invalid amount received",
        received: body,
      });
    }

    const currency = (body.currency || "cad").toLowerCase();

    const bookingId =
      body.bookingId ||
      body.booking_id ||
      "";

    const customerEmail =
      body.customerEmail ||
      body.customer_email ||
      body.email ||
      "";

    const origin =
      req.headers.origin ||
      process.env.SITE_URL ||
      "https://monttremblantlimoservices.com";

    const session = await stripe.checkout.sessions.create({

      mode: "payment",

      customer_email: customerEmail || undefined,

      payment_method_types: ["card"],

      line_items: [
        {
          price_data: {
            currency,
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: "Mont Tremblant Limo Booking",
              description: bookingId
                ? `Booking ID: ${bookingId}`
                : "Booking payment",
            },
          },
          quantity: 1,
        },
      ],

      success_url:
        `${origin}/booking.html?payment=success&session_id={CHECKOUT_SESSION_ID}`,

      cancel_url:
        `${origin}/booking.html?payment=cancelled`,

      metadata: {
        bookingId: String(bookingId),
        booking_id: String(bookingId),
      },

    });

    console.log("Stripe session created:", session.id);

    return res.status(200).json({
      url: session.url,
    });

  } catch (err) {

    console.error("Stripe error:", err);

    return res.status(500).json({
      error: err.message,
    });
  }
}
