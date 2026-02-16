// /api/bookings.js
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const { z } = require("zod");

// ---- helpers ----
function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function safe(s) {
  return String(s ?? "").replace(/[<>]/g, "");
}

function money(n, currency = "CAD") {
  const rounded = Math.round(Number(n) || 0);
  return `${currency}$${rounded}`;
}

function toNumber(v) {
  if (v === "" || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v) {
  const n = toNumber(v);
  return n === null ? null : Math.trunc(n);
}

function toNullableString(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// ---- schema (coerces strings -> numbers) ----
const BookingSchema = z.object({
  mode: z.enum(["one_way", "hourly"]),

  pickup_text: z.string().min(3),
  dropoff_text: z.preprocess(toNullableString, z.string().nullable().optional()),

  pickup_lat: z.preprocess(toNumber, z.number().nullable().optional()),
  pickup_lng: z.preprocess(toNumber, z.number().nullable().optional()),
  dropoff_lat: z.preprocess(toNumber, z.number().nullable().optional()),
  dropoff_lng: z.preprocess(toNumber, z.number().nullable().optional()),

  pickup_airport: z.preprocess(toNullableString, z.string().nullable().optional()),
  dropoff_airport: z.preprocess(toNullableString, z.string().nullable().optional()),

  pickup_datetime: z.string().min(5), // ISO string

  hours: z.preprocess(toInt, z.number().int().min(1).max(24).nullable().optional()),
  distance_m: z.preprocess(toInt, z.number().int().nullable().optional()),
  duration_s: z.preprocess(toInt, z.number().int().nullable().optional()),

  currency: z.enum(["CAD", "USD"]).default("CAD"),

  vehicle_key: z.string().min(2),

  price_estimate: z.preprocess((v) => {
    const n = toNumber(v);
    return n === null ? 0 : n;
  }, z.number().min(0)),

  customer_name: z.string().min(2),
  customer_email: z.string().email(),
  customer_phone: z.preprocess(toNullableString, z.string().nullable().optional()),

  passengers: z.preprocess(toInt, z.number().int().min(1).max(50).nullable().optional()),
  luggage: z.preprocess(toInt, z.number().int().min(0).max(50).nullable().optional()),
  notes: z.preprocess(toNullableString, z.string().nullable().optional()),
});

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
    ${b.mode === "hourly" ? `<p><b>Hours:</b> ${b.hours ?? "-"}</p>` : ""}
    <p><b>Vehicle:</b> ${safe(b.vehicle_key)}</p>
    <p><b>Estimated price:</b> ${money(b.price_estimate, b.currency)}</p>
    <p><b>Booking ID:</b> ${safe(id)}</p>
    <hr/>
    <p>If you need changes, reply to this email or WhatsApp us.</p>
  </div>`;
}

function adminEmailHtml(b, id) {
  return `
  <div style="font-family:Arial,sans-serif;line-height:1.5">
    <h2>New booking 🔔</h2>
    <p><b>ID:</b> ${safe(id)}</p>
    <p><b>Mode:</b> ${safe(b.mode)}</p>
    <p><b>Pickup:</b> ${safe(b.pickup_text)}</p>
    ${b.mode === "one_way" ? `<p><b>Dropoff:</b> ${safe(b.dropoff_text || "-")}</p>` : ""}
    <p><b>Date/Time:</b> ${new Date(b.pickup_datetime).toLocaleString()}</p>
    ${b.mode === "hourly" ? `<p><b>Hours:</b> ${b.hours ?? "-"}</p>` : ""}
    <p><b>Vehicle:</b> ${safe(b.vehicle_key)}</p>
    <p><b>Estimate:</b> ${money(b.price_estimate, b.currency)}</p>
    <hr/>
    <p><b>Name:</b> ${safe(b.customer_name)}</p>
    <p><b>Email:</b> ${safe(b.customer_email)}</p>
    <p><b>Phone:</b> ${safe(b.customer_phone || "-")}</p>
    <p><b>Passengers:</b> ${b.passengers ?? "-"}</p>
    <p><b>Luggage:</b> ${b.luggage ?? "-"}</p>
    <p><b>Notes:</b> ${safe(b.notes || "-")}</p>
  </div>`;
}

async function readJsonBody(req) {
  // Vercel usually gives req.body already parsed, but not always
  if (req.body && typeof req.body === "object") return req.body;

  const raw = await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

// ---- handler ----
module.exports = async (req, res) => {
  // CORS (safe default)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end("ok");
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method Not Allowed");
  }

  try {
    const supabase = createClient(
      getEnv("SUPABASE_URL"),
      getEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    const body = await readJsonBody(req);
    const b = BookingSchema.parse(body);

    // 1) Insert booking
    const { data: inserted, error } = await supabase
      .from("bookings")
      .insert([b])
      .select("id")
      .single();

    if (error) throw error;
    const bookingId = inserted.id;

    // 2) Email (best effort — don’t block booking)
    try {
      const resend = new Resend(getEnv("RESEND_API_KEY"));

      // Use RESEND_FROM if your domain is verified; otherwise keep resend.dev
      const from =
        process.env.RESEND_FROM ||
        "Mont Tremblant Limo <onboarding@resend.dev>";

      // Customer email
      await resend.emails.send({
        from,
        to: b.customer_email,
        subject: "We received your booking request",
        html: customerEmailHtml(b, bookingId),
      });

      // Admin email
      const adminTo =
        process.env.ADMIN_NOTIFY_EMAIL || process.env.ADMIN_NOTIFY_EMAI; // fallback for typo
      if (adminTo) {
        await resend.emails.send({
          from,
          to: adminTo,
          subject: `New booking: ${bookingId}`,
          html: adminEmailHtml(b, bookingId),
        });
      }
    } catch (emailErr) {
      // booking saved already — keep going
      console.error("Email send failed:", emailErr?.message || emailErr);
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: true, id: bookingId }));
  } catch (e) {
    console.error("Booking API error:", e?.message || e);
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok: false, error: e?.message || "Unknown error" }));
  }
};
