// api/bookings.js
// Vercel Serverless Function (CommonJS) - works without "type":"module"
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const { z } = require("zod");

// Convert "" -> null and strings -> numbers when possible
const numOpt = () =>
  z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().nullable().optional()
  );

const intOpt = () =>
  z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().int().nullable().optional()
  );

const BookingSchema = z.object({
  mode: z.enum(["one_way", "hourly"]),
  pickup_text: z.string().min(3),
  dropoff_text: z.string().optional().nullable(),

  pickup_lat: numOpt(),
  pickup_lng: numOpt(),
  dropoff_lat: numOpt(),
  dropoff_lng: numOpt(),

  pickup_airport: z.string().optional().nullable(),
  dropoff_airport: z.string().optional().nullable(),

  pickup_datetime: z.string().min(5),

  hours: intOpt().refine((v) => v == null || (v >= 1 && v <= 24), {
    message: "hours must be between 1 and 24",
  }),

  distance_m: intOpt(),
  duration_s: intOpt(),

  currency: z.enum(["CAD", "USD"]).default("CAD"),
  vehicle_key: z.string().min(2),

  // allow strings like "75" from the browser
  price_estimate: z.coerce.number().min(0),

  customer_name: z.string().min(2),
  customer_email: z.string().email(),
  customer_phone: z.string().optional().nullable(),

  passengers: intOpt().refine((v) => v == null || (v >= 1 && v <= 50), {
    message: "passengers must be between 1 and 50",
  }),
  luggage: intOpt().refine((v) => v == null || (v >= 0 && v <= 50), {
    message: "luggage must be between 0 and 50",
  }),

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

    // Better validation error messages
    const parsed = BookingSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "Invalid booking payload",
        issues: parsed.error.issues,
      });
    }
    const b = parsed.data;

    const { data: inserted, error } = await supabase
      .from("bookings")
      .insert([b])
      .select("id")
      .single();

    if (error) throw error;

    const bookingId = inserted.id;

    // Must be an address on your verified Resend domain
    const from =
      process.env.RESEND_FROM ||
      "Mont Tremblant Limo <info@monttremblantlimoservices.com>";

    // Where replies go (your inbox)
    const replyTo =
      process.env.REPLY_TO_EMAIL || "info@monttremblantlimoservices.com";

    const adminTo = process.env.ADMIN_NOTIFY_EMAIL;

    // Send emails, but do not fail booking if email fails
    let emailWarning = null;
    try {
      await resend.emails.send({
        from,
        to: b.customer_email,
        reply_to: replyTo,
        bcc: adminTo || undefined,
        subject: "We received your booking request",
        html: customerEmailHtml(b, bookingId),
      });

      if (adminTo) {
        await resend.emails.send({
          from,
          to: adminTo,
          reply_to: replyTo,
          subject: `New booking: ${bookingId}`,
          html: adminEmailHtml(b, bookingId),
        });
      }
    } catch (err) {
      console.error("RESEND FAILED (booking saved, continuing):", err);
      emailWarning = err?.message || "Email send failed";
    }

    return res.status(200).json({ ok: true, id: bookingId, emailWarning });
  } catch (e) {
    console.error("BOOKINGS ERROR:", e);
    return res.status(400).json({
      ok: false,
      error: e?.message || "Unknown error",
    });
  }
};
