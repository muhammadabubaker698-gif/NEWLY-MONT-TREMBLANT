import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    res.status(500).json({ error: "Missing STRIPE_SECRET_KEY in environment variables" });
    return;
  }

  const stripe = new Stripe(secret, { apiVersion: "2024-06-20" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    // ✅ Accept YOUR frontend fields
    const amount =
      Number(body.amount) ||
      Number(body.pay_now) ||
      Number(body.pay_now_cad) ||
      Number(body.estimate_total) ||
      Number(body.estimate_total_cad) ||
      0;

    const currency = (body.currency || "cad").toLowerCase();

    // ✅ Accept bookingId in both formats
    const bookingId = body.bookingId || body.booking_id || "";

    // ✅ Accept email in both formats
    const customerEmail = body.customerEmail || body.customer_email || body.email || "";

    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "Invalid amount" });
      return;
    }

    if (amount > 20000) {
      res.status(400).json({ error: "Amount too large" });
      return;
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: customerEmail || undefined,
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: "Mont Tremblant Limo — Booking Payment",
              description: bookingId ? `Booking ID: ${bookingId}` : undefined,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/booking.html?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/booking.html?payment=cancelled`,

      // ✅ Store BOTH keys so your webhook can always find it
      metadata: {
        bookingId: String(bookingId || ""),
        booking_id: String(bookingId || ""),
      },
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe session error:", err);
    res.status(500).json({ error: err?.message || "Failed to create Stripe session" });
  }
}
