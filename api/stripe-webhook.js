// /api/stripe-webhook.js
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function safe(s) {
  return String(s ?? "").replace(/[<>]/g, "");
}

async function readRawBody(req) {
  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", resolve);
    req.on("error", reject);
  });
  return Buffer.concat(chunks);
}

function moneyFromStripe(amountInCents, currency) {
  const amt = (Number(amountInCents) || 0) / 100;
  return `${String(currency || "cad").toUpperCase()} $${amt.toFixed(2)}`;
}

function adminEmailHtml({ bookingId, booking, stripeInfo }) {
  return `
  <div style="font-family:Arial,sans-serif;line-height:1.5">
    <h2>✅ Payment received</h2>
    <p><b>Booking ID:</b> ${safe(bookingId)}</p>
    <p><b>Amount:</b> ${safe(stripeInfo.amountText)}</p>
    <p><b>Stripe Session:</b> ${safe(stripeInfo.sessionId)}</p>
    <p><b>Payment Intent:</b> ${safe(stripeInfo.paymentIntentId || "-")}</p>
    <hr/>
    ${
      booking
        ? `
      <h3>Customer</h3>
      <p><b>Name:</b> ${safe(booking.customer_name || "-")}</p>
      <p><b>Email:</b> ${safe(booking.customer_email || "-")}</p>
      <p><b>Phone:</b> ${safe(booking.customer_phone || "-")}</p>
      <h3>Trip</h3>
      <p><b>Mode:</b> ${safe(booking.mode || "-")}</p>
      <p><b>Pickup:</b> ${safe(booking.pickup_text || "-")}</p>
      <p><b>Dropoff:</b> ${safe(booking.dropoff_text || "-")}</p>
      <p><b>Pickup time:</b> ${safe(booking.pickup_datetime || "-")}</p>
      <p><b>Vehicle:</b> ${safe(booking.vehicle_key || "-")}</p>
      <p><b>Notes:</b> ${safe(booking.notes || "-")}</p>
    `
        : `<p><i>Booking details not found in Supabase (bookingId didn’t match a row).</i></p>`
    }
  </div>`;
}

function customerEmailHtml({ bookingId, booking, stripeInfo }) {
  const name = booking?.customer_name || "there";
  return `
  <div style="font-family:Arial,sans-serif;line-height:1.5">
    <h2>Payment confirmed ✅</h2>
    <p>Hi ${safe(name)},</p>
    <p>We received your payment. We’ll contact you shortly to confirm details.</p>
    <p><b>Booking ID:</b> ${safe(bookingId)}</p>
    <p><b>Amount:</b> ${safe(stripeInfo.amountText)}</p>
    <hr/>
    ${
      booking
        ? `
      <p><b>Pickup:</b> ${safe(booking.pickup_text || "-")}</p>
      <p><b>Dropoff:</b> ${safe(booking.dropoff_text || "-")}</p>
      <p><b>Pickup time:</b> ${safe(booking.pickup_datetime || "-")}</p>
      <p><b>Vehicle:</b> ${safe(booking.vehicle_key || "-")}</p>
    `
        : ""
    }
    <p>If you need changes, reply to this email or WhatsApp us.</p>
  </div>`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method Not Allowed");
  }

  try {
    const stripe = new Stripe(mustEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2023-10-16",
    });

    const sig = req.headers["stripe-signature"];
    if (!sig) {
      res.statusCode = 400;
      return res.end("Missing Stripe-Signature header");
    }

    const rawBody = await readRawBody(req);

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        sig,
        mustEnv("STRIPE_WEBHOOK_SECRET")
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      res.statusCode = 400;
      return res.end(`Webhook Error: ${err.message}`);
    }

    // We care about successful checkout completion
    const relevantTypes = new Set([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ]);

    if (!relevantTypes.has(event.type)) {
      // Always return 200 so Stripe doesn't keep retrying
      res.statusCode = 200;
      return res.end("ignored");
    }

    const session = event.data.object;

    // bookingId stored by your create-checkout-session.js
    const bookingId =
      session.client_reference_id || session.metadata?.bookingId;

    if (!bookingId) {
      console.error("No bookingId on session:", session.id);
      res.statusCode = 200;
      return res.end("no-bookingId");
    }

    const supabase = createClient(
      mustEnv("SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    // Try fetch booking row
    const { data: booking, error: fetchErr } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (fetchErr) {
      console.error("Supabase fetch error:", fetchErr.message);
    }

    const amountTotal = session.amount_total ?? session.amount_subtotal ?? 0;
    const currency = session.currency || "cad";
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;

    const stripeInfo = {
      sessionId: session.id,
      paymentIntentId: paymentIntentId || null,
      amountTotal,
      currency,
      amountText: moneyFromStripe(amountTotal, currency),
    };

    // Update booking if it exists
    if (booking) {
      // idempotent: if already paid, do nothing
      const alreadyPaid = String(booking.payment_status || "").toLowerCase() === "paid";
      if (!alreadyPaid) {
        const updates = {
          payment_status: "paid",
          paid_at: new Date().toISOString(),
          stripe_session_id: session.id,
          stripe_payment_intent_id: paymentIntentId || null,
          amount_paid: (Number(amountTotal) || 0) / 100,
          currency: String(currency || "cad").toUpperCase(),
          stripe_customer_email: session.customer_details?.email || session.customer_email || null,
        };

        const { error: updErr } = await supabase
          .from("bookings")
          .update(updates)
          .eq("id", bookingId);

        if (updErr) {
          console.error("Supabase update error:", updErr.message);
        }
      }
    } else {
      console.warn("Booking not found in Supabase for bookingId:", bookingId);
    }

    // Send emails (best-effort)
    try {
      const resend = new Resend(mustEnv("RESEND_API_KEY"));

      // If domain not verified, keep resend.dev
      const from =
        process.env.RESEND_FROM ||
        "Mont Tremblant Limo <onboarding@resend.dev>";

      const adminTo =
        process.env.ADMIN_NOTIFY_EMAIL ||
        process.env.ADMIN_NOTIFY_EMAI ||
        "groupedelson@gmail.com";

      // Admin email always
      await resend.emails.send({
        from,
        to: adminTo,
        subject: `Payment received: ${bookingId}`,
        html: adminEmailHtml({ bookingId, booking, stripeInfo }),
      });

      // Customer email (if we have it)
      const customerEmail =
        booking?.customer_email ||
        session.customer_details?.email ||
        session.customer_email;

      if (customerEmail) {
        await resend.emails.send({
          from,
          to: customerEmail,
          subject: "Payment confirmed – Mont Tremblant Limo",
          html: customerEmailHtml({ bookingId, booking, stripeInfo }),
        });
      }
    } catch (emailErr) {
      console.error("Resend error:", emailErr?.message || emailErr);
    }

    res.statusCode = 200;
    return res.end("ok");
  } catch (err) {
    console.error("stripe-webhook fatal error:", err?.message || err);
    // Still return 200 so Stripe doesn't retry endlessly while you're testing
    res.statusCode = 200;
    return res.end("ok");
  }
};
