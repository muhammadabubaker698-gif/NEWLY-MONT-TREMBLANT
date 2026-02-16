// api/stripe-webhook.js
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

// IMPORTANT for Stripe signature verification:
// Vercel Node functions: we must read raw body
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    const stripe = new Stripe(mustEnv("STRIPE_SECRET_KEY"), { apiVersion: "2024-06-20" });

    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(400).send("Missing stripe-signature header");

    const rawBody = await getRawBody(req);

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        sig,
        mustEnv("STRIPE_WEBHOOK_SECRET")
      );
    } catch (err) {
      console.error("Webhook signature verification failed.", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const supabase = createClient(
      mustEnv("SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    const resend = new Resend(mustEnv("RESEND_API_KEY"));
    const fromEmail =
      process.env.RESEND_FROM || "Mont Tremblant Limo <onboarding@resend.dev>";
    const adminTo =
      process.env.ADMIN_NOTIFY_EMAIL ||
      process.env.ADMIN_NOTIFY_EMAI ||
      null;

    // We handle these events:
    // - checkout.session.completed (best: has metadata + client_reference_id)
    // - payment_intent.succeeded (fallback)
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const bookingId =
        session.client_reference_id ||
        (session.metadata && session.metadata.bookingId) ||
        (session.metadata && session.metadata.booking_id);

      if (!bookingId) {
        console.warn("No bookingId found in session.");
        return res.status(200).json({ received: true, note: "no bookingId" });
      }

      const paymentStatus = session.payment_status === "paid" ? "paid" : "unpaid";
      const stripe_session_id = session.id;
      const stripe_payment_intent =
        typeof session.payment_intent === "string" ? session.payment_intent : null;

      const { data: updated, error: upErr } = await supabase
        .from("bookings")
        .update({
          payment_status: paymentStatus,
          stripe_session_id,
          stripe_payment_intent,
        })
        .eq("id", bookingId)
        .select("*")
        .single();

      if (upErr) {
        console.error("Supabase update failed:", upErr.message);
      } else if (adminTo && paymentStatus === "paid") {
        // Notify provider payment received
        await resend.emails.send({
          from: fromEmail,
          to: adminTo,
          subject: `Payment received ✅ (${bookingId})`,
          html: `
            <h2>Payment received ✅</h2>
            <p><b>Booking ID:</b> ${bookingId}</p>
            <p><b>Customer:</b> ${updated?.customer_name || "-"}</p>
            <p><b>Email:</b> ${updated?.customer_email || "-"}</p>
            <p><b>Phone:</b> ${updated?.customer_phone || "-"}</p>
            <p><b>Amount:</b> ${updated?.price_estimate ? `${(updated.currency || "CAD").toUpperCase()}$${Number(updated.price_estimate).toFixed(0)}` : "-"}</p>
            <p><b>Pickup:</b> ${updated?.pickup || "-"}</p>
            <p><b>Dropoff:</b> ${updated?.dropoff || "-"}</p>
            <p><b>Stripe session:</b> ${stripe_session_id}</p>
          `,
        });
      }

      return res.status(200).json({ received: true });
    }

    // Not handling other event types right now
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("WEBHOOK ERROR:", e);
    return res.status(500).send(e.message || "Internal Server Error");
  }
};
