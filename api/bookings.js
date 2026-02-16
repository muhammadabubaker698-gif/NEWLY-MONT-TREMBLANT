// /api/bookings.js
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  // CORS (optional but helpful)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // ✅ ENV
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    // ✅ IMPORTANT: correct admin email env (your screenshot had typo)
    const ADMIN_NOTIFY_EMAIL =
      process.env.ADMIN_NOTIFY_EMAIL ||
      process.env.ADMIN_NOTIFY_EMAI || // fallback in case old typo exists
      "groupedelson@gmail.com";

    // ✅ Use a verified sender (fallback to Resend onboarding sender)
    const RESEND_FROM = process.env.RESEND_FROM || "onboarding@resend.dev";
    const FROM = `Mont Tremblant Limo <${RESEND_FROM}>`;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    if (!RESEND_API_KEY) {
      throw new Error("Missing RESEND_API_KEY");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const resend = new Resend(RESEND_API_KEY);

    // ---- Basic fields coming from your index.html ----
    const booking = {
      customer_name: body.customer_name || body.name || "",
      customer_email: body.customer_email || body.email || "",
      customer_phone: body.customer_phone || body.phone || "",
      passengers: body.passengers ?? null,
      luggage: body.luggage ?? null,
      notes: body.notes || "",
      mode: body.mode || "point_to_point",

      pickup_text: body.pickup_text || body.pickup || "",
      dropoff_text: body.dropoff_text || body.dropoff || "",
      pickup_datetime: body.pickup_datetime || body.pickup_date || null,

      hours: body.hours ?? null,
      duration_s: body.duration_s ?? null,
      distance_m: body.distance_m ?? null,

      price_estimate: body.price_estimate ?? body.estimated_total ?? null,
      currency: body.currency || "CAD",

      vehicle_key: body.vehicle_key || null,

      // airport flags/coords if present
      pickup_airport: body.pickup_airport ?? false,
      dropoff_airport: body.dropoff_airport ?? false,
      pickup_lat: body.pickup_lat ?? null,
      pickup_lng: body.pickup_lng ?? null,
      dropoff_lat: body.dropoff_lat ?? null,
      dropoff_lng: body.dropoff_lng ?? null,

      // payment tracking
      payment_status: "unpaid",
    };

    // ✅ Insert into Supabase
    const { data, error } = await supabase
      .from("bookings")
      .insert(booking)
      .select("id")
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      throw new Error(error.message || "Supabase insert failed");
    }

    const bookingId = data.id;
    console.log("Booking inserted:", bookingId);

    // ✅ Email content
    const subject = `New Booking Request (${bookingId})`;
    const html = `
      <h2>New Booking Request</h2>
      <p><b>Booking ID:</b> ${bookingId}</p>
      <p><b>Name:</b> ${booking.customer_name}</p>
      <p><b>Email:</b> ${booking.customer_email}</p>
      <p><b>Phone:</b> ${booking.customer_phone}</p>
      <p><b>Pickup:</b> ${booking.pickup_text}</p>
      <p><b>Dropoff:</b> ${booking.dropoff_text}</p>
      <p><b>Pickup Date/Time:</b> ${booking.pickup_datetime || ""}</p>
      <p><b>Passengers:</b> ${booking.passengers ?? ""}</p>
      <p><b>Luggage:</b> ${booking.luggage ?? ""}</p>
      <p><b>Notes:</b> ${booking.notes || ""}</p>
      <p><b>Estimate:</b> ${booking.price_estimate ?? ""} ${booking.currency}</p>
      <hr/>
      <p>Mode: ${booking.mode}</p>
    `;

    // ✅ Send admin email
    const adminSend = await resend.emails.send({
      from: FROM,
      to: ADMIN_NOTIFY_EMAIL,
      subject,
      html,
    });
    console.log("Admin email result:", adminSend?.data?.id || adminSend);

    // ✅ Send customer confirmation (optional)
    if (booking.customer_email) {
      const custSend = await resend.emails.send({
        from: FROM,
        to: booking.customer_email,
        subject: "We received your booking request",
        html: `
          <p>Hi ${booking.customer_name || "there"},</p>
          <p>We received your request. Your booking ID is <b>${bookingId}</b>.</p>
          <p>We will contact you shortly to confirm.</p>
          <p>— Mont Tremblant Limo</p>
        `,
      });
      console.log("Customer email result:", custSend?.data?.id || custSend);
    }

    return res.status(200).json({ ok: true, id: bookingId });
  } catch (e) {
    console.error("bookings.js error:", e);
    return res.status(400).json({ ok: false, error: e.message || "Unknown error" });
  }
};
