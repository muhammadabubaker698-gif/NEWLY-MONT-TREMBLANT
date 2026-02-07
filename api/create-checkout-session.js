const Stripe = require("stripe");

function toCents(cad) {
  const n = Number(cad);
  if (!Number.isFinite(n) || n < 1) return null;
  if (n > 20000) return null; // safety cap
  return Math.round(n * 100);
}

module.exports = async (req, res) => {
  try {
    // Clear error if env var missing
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        error: "STRIPE_SECRET_KEY is not set in Vercel Environment Variables."
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed. Use POST." });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const b = req.body || {};

    if (!b.name || !b.date || !b.time || !b.pickup || !b.dropoff || !b.vehicle) {
      return res.status(400).json({ error: "Missing required booking fields." });
    }

    const amount = toCents(b.pay_now_cad);
    if (!amount) return res.status(400).json({ error: "Invalid payment amount." });

    const DOMAIN = process.env.PUBLIC_DOMAIN || "https://www.monttremblantlimoservices.com";

    const description =
      `Trip: ${b.triptype}\n` +
      `Vehicle: ${b.vehicle}\n` +
      `Date/Time: ${b.date} ${b.time}\n` +
      `Pickup: ${b.pickup}\n` +
      `Dropoff: ${b.dropoff}\n` +
      `Estimate: ${b.estimate_text}\n` +
      (b.notes ? `Notes: ${b.notes}` : "");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "cad",
          product_data: {
            name: "Mont Tremblant Limo Reservation (Full Payment)",
            description: description.slice(0, 4000)
          },
          unit_amount: amount
        },
        quantity: 1
      }],
      metadata: {
        name: b.name,
        phone: b.phone || "",
        date: b.date,
        time: b.time,
        pickup: b.pickup,
        dropoff: b.dropoff,
        triptype: b.triptype || "",
        vehicle: b.vehicle || "",
        hours: b.hours || "",
        roundtrip: b.roundtrip || "",
        estimate_total_cad: String(b.estimate_total_cad ?? "")
      },
      success_url: `${DOMAIN}/?payment=success`,
      cancel_url: `${DOMAIN}/?payment=cancel`
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Function error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
