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

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const supabase = createClient(
      getEnv("SUPABASE_URL"),
      getEnv("SUPABASE_SERVICE_ROLE_KEY")
    );
    const resend = new Resend(getEnv("RESEND_API_KEY"));

    // read raw body (works reliably on Vercel)
    const body = await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        try {
          resolve(JSON.parse(data || "{}"));
        } catch (e) {
          reject(e);
        }
      });
    });

    const b = BookingSchema.parse(body);

    const { data: inserted, error } = await supabase
      .from("bookings")
      .insert([b])
      .select("id")
      .single();

    if (error) throw error;

    const bookingId = inserted.id;

    // NOTE: keep as resend.dev until your domain sender is verified in Resend
    const from = "Mont Tremblant Limo <onboarding@resend.dev>";

    // customer email
    await resend.emails.send({
      from,
      to: b.customer_email,
      subject: "We received your booking request",
      html: customerEmailHtml(b, bookingId),
    });

    // ✅ provider/admin email
    const adminTo = process.env.ADMIN_NOTIFY_EMAIL;
    if (!adminTo) {
      console.warn("ADMIN_NOTIFY_EMAIL is missing. Provider email will NOT be sent.");
    } else {
      await resend.emails.send({
        from,
        to: adminTo,
        subject: `New booking: ${bookingId}`,
        html: adminEmailHtml(b, bookingId),
      });
    }

    return res.status(2
