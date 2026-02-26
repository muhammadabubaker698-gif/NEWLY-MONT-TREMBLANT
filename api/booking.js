// /api/booking.js
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

module.exports = async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    console.log("Saving booking:", body);

    const { data, error } = await supabase
      .from("bookings")
      .insert([body])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(400).json({
        ok: false,
        error: error.message
      });
    }

    const bookingId = data.id;

    // Email (optional, never block Stripe)
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);

      await resend.emails.send({
        from: process.env.RESEND_FROM,
        to: body.customer_email,
        subject: "Booking received",
        html: `<p>Your booking ID: ${bookingId}</p>`
      });

    } catch(e) {
      console.log("Email skipped:", e.message);
    }

    return res.status(200).json({
      ok: true,
      id: bookingId
    });

  } catch (err) {

    console.error("Booking API crash:", err);

    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};
