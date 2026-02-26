// /api/bookings.js (Vercel Serverless - CommonJS)

const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        ok: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Vercel env",
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await readBody(req);

    // 1) Save booking (must succeed)
    const { data, error } = await supabase
      .from("bookings")
      .insert([body])
      .select("id")
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(400).json({
        ok: false,
        error: error.message,
        details: error,
      });
    }

    const bookingId = data.id;

    // 2) Email (never block Stripe)
    try {
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) throw new Error("Missing RESEND_API_KEY");
      const resend = new Resend(resendKey);

      const from =
        process.env.RESEND_FROM ||
        "Mont Tremblant Limo <info@monttremblantlimoservices.com>";

      const replyTo =
        process.env.REPLY_TO_EMAIL || "info@monttremblantlimoservices.com";

      const adminTo = process.env.ADMIN_NOTIFY_EMAIL;

      await resend.emails.send({
        from,
        to: body.customer_email,
        replyTo,
        subject: "We received your booking request",
        html: `<p>Thanks! Your booking ID is <b>${bookingId}</b>.</p>`,
        bcc: adminTo || undefined,
      });
    } catch (e) {
      console.error("Resend failed (booking saved, continuing):", e);
    }

    return res.status(200).json({ ok: true, id: bookingId });
  } catch (e) {
    console.error("BOOKINGS API CRASH:", e);
    return res.status(500).json({ ok: false, error: e.message || "Server error" });
  }
};
