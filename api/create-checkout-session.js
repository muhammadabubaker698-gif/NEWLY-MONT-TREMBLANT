// api/create-checkout-session.js
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // ---- ENV CHECKS ----
    const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // IMPORTANT
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    // where YOU want to receive booking emails:
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL; // e.g. yourbusiness@email.com

    // your public domain for redirect after payment:
    const SITE_URL = process.env.SITE_URL || "https://www.monttremblantlimoservices.com";

    if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
    if (!SUPABASE_URL) return res.status(500).json({ error: "Missing SUPABASE_URL" });
    if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" });
    if (!RESEND_API_KEY) return res.status(500).json({ error: "Missing RESEND_API_KEY" });
    if (!ADMIN_EMAIL) return res.status(500).json({ error: "Missing ADMIN_EMAIL" });

    const stripe = new Stripe(STRIPE_SECRET_KEY);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const resend = new Resend(RESEND_API_KEY);

    const body = req.body || {};
    const booking_id = body.booking_id; // coming from your frontend after /api/bookings
    const customer = body.customer || {};
    const booking_details = body.booking_details || {};

    // ---- BASIC VALIDATION ----
    if (!booking_id) return res.status(400).json({ error: "Missing booking_id" });
    if (!customer.email) return res.status(400).json({ error: "Missing customer.email" });
    if (!customer.name) return res.status(400).json({ error: "Missing customer.name" });

    // Price coming from your UI
    const amount = Number(body.amount);
    const currency = (body.currency || booking_details.currency || "CAD").toLowerCase();

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // ---- 1) UPSERT TO SUPABASE (so it ALWAYS shows in bookings) ----
    // IMPORTANT: These column names MUST exist in your table
    // If you still get a “Could not find column …” popup, add that column in Supabase.
    const row = {
      id: booking_id,

      customer_name: customer.name,
      customer_email: customer.email,
      customer_phone: customer.phone || null,

      // common booking fields from your frontend snippet
      pickup_text: booking_details.pickup_text || null,
      dropoff_text: booking_details.dropoff_text || null,

      pickup_place_id: booking_details.pickup_place_id || null,
      dropoff_place_id: booking_details.dropoff_place_id || null,

      pickup_lat: booking_details.pickup_lat ?? null,
      pickup_lng: booking_details.pickup_lng ?? null,
      dropoff_lat: booking_details.dropoff_lat ?? null,
      dropoff_lng: booking_details.dropoff_lng ?? null,

      pickup_datetime: booking_details.pickup_datetime || null,

      mode: booking_details.mode || null,
      passengers: booking_details.passengers ?? null,
      luggage: booking_details.luggage ?? null,
      hours: booking_details.hours ?? null,

      distance_m: booking_details.distance_m ?? null,
      duration_s: booking_details.duration_s ?? null,

      price_estimate: booking_details.price_estimate ?? amount,
      currency: (booking_details.currency || body.currency || "CAD"),

      vehicle_key: booking_details.vehicle_key || null,
      notes: booking_details.notes || null,

      // payment tracking
      payment_status: "pending",
      stripe_checkout_status: "created",
    };

    // Upsert (insert if new, update if already exists)
    const { error: upsertErr } = await supabase
      .from("bookings")
      .upsert(row, { onConflict: "id" });

    if (upsertErr) {
      console.error("Supabase upsert error:", upsertErr);
      return res.status(500).json({
        error: "Supabase insert failed",
        details: upsertErr.message,
      });
    }

    // ---- 2) SEND EMAILS VIA RESEND (request received) ----
    // You can customize these messages later; this is the minimum so you get notified.
    const summaryLines = [
      `Booking ID: ${booking_id}`,
      `Name: ${customer.name}`,
      `Email: ${customer.email}`,
      customer.phone ? `Phone: ${customer.phone}` : null,
      booking_details.pickup_text ? `Pickup: ${booking_details.pickup_text}` : null,
      booking_details.dropoff_text ? `Dropoff: ${booking_details.dropoff_text}` : null,
      booking_details.pickup_datetime ? `Pickup time: ${booking_details.pickup_datetime}` : null,
      booking_details.mode ? `Mode: ${booking_details.mode}` : null,
      booking_details.vehicle_key ? `Vehicle: ${booking_details.vehicle_key}` : null,
      booking_details.passengers != null ? `Passengers: ${booking_details.passengers}` : null,
      booking_details.luggage != null ? `Luggage: ${booking_details.luggage}` : null,
      booking_details.hours != null ? `Hours: ${booking_details.hours}` : null,
      booking_details.price_estimate != null ? `Estimate: ${booking_details.price_estimate} ${booking_details.currency || "CAD"}` : null,
      booking_details.notes ? `Notes: ${booking_details.notes}` : null,
    ].filter(Boolean);

    const adminText = `New booking request received:\n\n${summaryLines.join("\n")}`;
    const customerText =
      `Thanks! We received your booking request.\n\n${summaryLines.join("\n")}\n\n` +
      `Next step: you will be redirected to Stripe to complete payment.`;

    // Send to you
    await resend.emails.send({
      from: "Mont Tremblant Limo <onboarding@resend.dev>", // change to your verified domain later
      to: ADMIN_EMAIL,
      subject: `New Booking Request (${booking_id})`,
      text: adminText,
    });

    // Send to customer
    await resend.emails.send({
      from: "Mont Tremblant Limo <onboarding@resend.dev>", // change later
      to: customer.email,
      subject: "We received your booking request",
      text: customerText,
    });

    // ---- 3) CREATE STRIPE CHECKOUT SESSION ----
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: "Mont Tremblant Limo Booking",
              description: `Booking ID: ${booking_id}`,
            },
          },
        },
      ],
      // attach booking_id so you can use it later in webhook if you add one
      metadata: { booking_id },

      // after payment
      success_url: `${SITE_URL}/?payment=success&booking_id=${encodeURIComponent(booking_id)}`,
      cancel_url: `${SITE_URL}/?payment=cancelled&booking_id=${encodeURIComponent(booking_id)}`,
    });

    // save Stripe session id into Supabase
    const { error: updateErr } = await supabase
      .from("bookings")
      .update({
        stripe_session_id: session.id,
        stripe_checkout_status: "redirected",
      })
      .eq("id", booking_id);

    if (updateErr) {
      console.error("Supabase update stripe_session_id error:", updateErr);
      // don't block payment redirect, just log
    }

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("create-checkout-session crash:", err);
    return res.status(500).json({
      error: "Internal Server Error",
      details: err && err.message ? err.message : String(err),
    });
  }
};
