// api/bookings.js
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const { z } = require("zod");

const BookingSchema = z.object({
  mode: z.enum(["one_way", "hourly"]),
  pickup_text: z.string().min(3),
  dropoff_text: z.string().optional().nullable(),
  pickup_lat: z.number().optional().nullable(),
  pickup_lng: z.number().optional().nullable(),
  dropoff_lat: z.number().optional().nullable(),
  dropoff_lng: z.number().optional().nullable(),
  pickup_airport: z.string().optional().nullable(),
  dropoff_airport: z.string().optional().nullable(),
  pickup_datetime: z.string().min(5),
  hours: z.number().int().min(1).max(24).optional().nullable(),
  distance_m: z.number().int().optional().nullable(),
  duration_s: z.number().int().optional().nullable(),
  currency: z.enum(["CAD", "USD"]).default("CAD"),
  vehicle_key: z.string().min(2),
  price_estimate: z.number().min(0),
  customer_name: z.string().min(2),
  customer_email: z.string().email(),
  customer_phone: z.string().optional().nullable(),
  passengers: z.number().int().min(1).max(50).optional().nullable(),
  luggage: z.number().int().min(0).max(50).optional().nullable(),
  notes: z.string().optional().nullable(),
});

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function money(n, currency = "CAD") {
  const rounded = Math.round(Number(n) || 0);
  return `${currency}$${rounded}`;
}
function safe(s) {
  return String(s ?? "").replace(/[<>]/g, "");
}

function customerEmailHtml(b, id) {
  return `
  <div style="font-family:Arial,sans-serif;line-height:1.5">
    <h2>Booking received ✅</h2>
    <p>Hi ${safe(b.customer_name)},</p>
    <p>We received your request. We’ll confirm shortly.</p>
    <hr/>
    <p><b>Pickup:</b> ${safe(b.pickup_text)}</p>
    ${b.mode === "one_way" ? `<p><b>Dropoff:</b> ${safe(b.dropoff_text || "-")}</p>` : ""}
    <p><b>Date/Time:</b> ${new Date(b.pickup_datetime).toLocaleString()}</p>
    ${b.mode === "hourly" ? `<p><b>Hours:</b> ${b.hours}</p>` : ""}
    <p><b>Vehicle:</b> ${safe(b.vehicle_key)}</p>
    <p><b>Estimated price:</b> ${money(b.price_estimate, b.currency)}</p>
    <p><b>Booking ID:</b> ${id}</p>
    <hr/>
    <p>If you need changes, reply to this email or WhatsApp us.</p>
  </div>`;
}

function adminEmailHtml(b, id) {
  return `
  <div style="font-family:Arial,sans-serif;line-height:1.5">
    <h2>New booking 🔔</h2>
    <p><b>ID:</b> ${id}</p>
    <p><b>Mode:</b> ${safe(b.mode)}</p>
    <p><b>Pickup:</b> ${safe(b.pickup_text)}</p>
    ${b.mode === "one_way" ? `<p><b>Dropoff:</b> ${safe(b.dropoff_text || "-")}</p>` : ""}
    <p><b>Date/Time:</b> ${new Date(b.pickup_datetime).toLocaleString()}</p>
    ${b.mode === "hourly" ? `<p><b>Hours:</b> ${b.hours}</p>` : ""}
    <p><b>Vehicle:</b> ${safe(b.vehicle_key)}</p>
    <p><b>Estimate:</b> ${money(b.price_estimate, b.currency)}</p>
    <hr/>
    <p><b>Name:</b> ${safe(b.customer_name)}</p>
    <p><b>Email:</b> ${safe(b.customer_email)}</p>
    <p><b>Phone:</b> ${safe(b.customer_phone || "-")}</p>
    <p><b>Passengers:</b> ${safe(b.passengers ?? "-")}</p>
    <p><b>Luggage:</b> ${safe(b.luggage ?? "-")}</p>
    <p><b>Notes:</b> ${safe(b.notes || "-")}</p>
  </div>`;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
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
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const supabase = createClient(
      getEnv("SUPABASE_URL"),
      getEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    const resend = new Resend(getEnv("RESEND_API_KEY"));

    const body = await readJsonBody(req);
    const b = BookingSchema.parse(body);

    const { data: inserted, error } = await supabase
      .from("bookings")
      .insert([b])
      .select("id")
      .single();

    if (error) throw error;

    const bookingId = inserted.id;

    const from = "Mont Tremblant Limo <onboarding@resend.dev>";
    const adminTo = (process.env.ADMIN_NOTIFY_EMAIL || "").trim();

    // Debug logs (check Vercel Logs -> Functions)
    console.log("ADMIN_NOTIFY_EMAIL =", JSON.stringify(adminTo));
    console.log("CUSTOMER EMAIL =", JSON.stringify(b.customer_email));
    console.log("RESEND_API_KEY exists?", !!process.env.RESEND_API_KEY);

    // -------- CUSTOMER EMAIL (WITH BACKUP BCC TO ADMIN) --------
    try {
      const customerResp = await resend.emails.send({
        from,
        to: b.customer_email,
        bcc: adminTo || undefined, // backup notification
        subject: "We received your booking request",
        html: customerEmailHtml(b, bookingId),
      });
      console.log("RESEND CUSTOMER RESPONSE =", customerResp);
    } catch (err) {
      console.error("RESEND CUSTOMER ERROR =", err);
    }

    // -------- ADMIN EMAIL (SEPARATE) --------
    try {
      if (!adminTo) {
        console.warn("ADMIN EMAIL SKIPPED (ADMIN_NOTIFY_EMAIL missing)");
      } else {
        console.log("SENDING ADMIN EMAIL TO =", JSON.stringify(adminTo));
        const adminResp = await resend.emails.send({
          from,
          to: adminTo,
          subject: `New booking: ${bookingId}`,
          html: adminEmailHtml(b, bookingId),
        });
        console.log("RESEND ADMIN RESPONSE =", adminResp);
      }
    } catch (err) {
      console.error("RESEND ADMIN ERROR =", err);
    }

    return res.status(200).json({ ok: true, id: bookingId, booking_id: bookingId });
  } catch (e) {
    console.error("BOOKINGS ERROR:", e);
    return res.status(400).json({
      ok: false,
      error: e?.message || "Unknown error",
    });
  }
};
