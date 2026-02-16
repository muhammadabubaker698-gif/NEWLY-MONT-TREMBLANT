// /api/stripe-webhook.js
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    // IMPORTANT: Vercel needs raw body for Stripe signature. If this fails, see note below.
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const bookingId = session.metadata?.booking_id || session.client_reference_id;
      const paymentStatus = session.payment_status; // "paid"
      const amountTotal = (session.amount_total ?? 0) / 100;
      const currency = session.currency?.toUpperCase();

      if (bookingId) {
        const supabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );

        // Update booking row
        const { error } = await supabase
          .from("bookings")
          .update({
            payment_status: paymentStatus,
            estimated_total: amountTotal, // optional
            currency: currency,           // optional
          })
          .eq("id", bookingId);

        if (error) console.error("Supabase update error:", error);
      }
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("Webhook handler error:", e);
    return res.status(500).send("Webhook handler failed");
  }
};
