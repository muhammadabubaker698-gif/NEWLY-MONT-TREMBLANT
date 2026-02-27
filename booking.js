// api/bookings.js
export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).json({
        error: "Missing Supabase environment variables"
      });
    }

    const booking = req.body;

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          name: booking.name || "",
          email: booking.email || "",
          phone: booking.phone || "",
          pickup: booking.pickup || "",
          dropoff: booking.dropoff || "",
          date: booking.date || "",
          time: booking.time || "",
          vehicle: booking.vehicle || "",
          price: booking.price || 0
        })
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({
        error: text
      });
    }

    return res.status(200).json({
      success: true
    });

  } catch (err) {

    return res.status(500).json({
      error: err.message
    });

  }
}
