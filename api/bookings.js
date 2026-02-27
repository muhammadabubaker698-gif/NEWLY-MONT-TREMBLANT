// /api/bookings.js (CommonJS / require style)

const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  // CORS (optional but helpful)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        error:
          "Missing env vars: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Accept both naming styles (so frontend changes won’t break you)
    const body = req.body || {};

    const name = body.name ?? body.customer_name ?? null;
    const email = body.email ?? body.customer_email ?? null;
    const phone = body.phone ?? body.customer_phone ?? null;

    // Trip fields (support old + new)
    const pickup_location = body.pickup_location ?? body.pickup_text ?? body.pickup_address ?? null;
    const dropoff_location = body.dropoff_location ?? body.dropoff_text ?? body.dropoff_address ?? null;

    const vehicle = body.vehicle ?? body.vehicle_key ?? null;
    const price = body.price ?? null;

    const passengers =
      body.passengers === "" || body.passengers == null
        ? null
        : Number(body.passengers);

    const luggage =
      body.luggage === "" || body.luggage == null ? null : Number(body.luggage);

    const notes = body.notes ?? null;

    // Optional Stripe fields
    const stripe_session_id = body.stripe_session_id ?? null;
    const stripe_payment_intent = body.stripe_payment_intent ?? null;

    // If your SQL expects NOT NULL on these, this protects you.
    if (!name || !email || !phone || !pickup_location || !dropoff_location) {
      return res.status(400).json({
        error:
          "Missing required fields (name, email, phone, pickup_location, dropoff_location).",
      });
    }

    const insertPayload = {
      name,
      email,
      phone,
      pickup_location,
      dropoff_location,
      vehicle,
      price,
      passengers,
      luggage,
      notes,

      // payment tracking
      payment_status: "unpaid",
      stripe_session_id,
      stripe_payment_intent,
    };

    const { data, error } = await supabase
      .from("bookings")
      .insert([insertPayload])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({
        error: error.message,
        details: error,
      });
    }

    return res.status(200).json({
      success: true,
      booking_id: data.id,
      data,
    });
  } catch (err) {
    console.error("API crash:", err);
    return res.status(500).json({
      error: err.message || "Internal Server Error",
    });
  }
};
