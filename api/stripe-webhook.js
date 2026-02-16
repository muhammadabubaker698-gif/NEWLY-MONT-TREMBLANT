const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

module.exports = async (req, res) => {
  try {
    const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"));

    // Read raw body as Buffer
    const buf = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(Buffer.from(c)));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(400).send("Missing stripe-signature");

    const event = stripe.webhooks.constructEvent(
      buf,
      sig,
      getEnv("STRIPE_WEBHOOK_SECRET")
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // Accept all variants
      const bookingId =
        session.metadata?.booking_id ||
        session.metadata?.bookingId ||
        session.client_reference_id ||
        null;

      if (bookingId) {
        const supabase = createClient(
          getEnv("SUPABASE_URL"),
          getEnv("SUPABASE_SERVICE_ROLE_KEY")
        );

        await supabase
          .from("bookings")
          .update({
            payment_status: "paid",
            stripe_session_id: session.id,
            stripe_payment_intent: session.payment_intent || null,
          })
          .eq("id", bookingId);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
};
