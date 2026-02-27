// api/bookings.js (Vercel Serverless Function - ESM)
// Public endpoint used by booking.html to create a booking in Supabase.

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function isObject(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

async function readJsonBody(req) {
  // Vercel often provides req.body as an object already.
  if (isObject(req.body)) return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function emptyToNull(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
}

function toIntOrNull(v) {
  v = emptyToNull(v);
  if (v === null) return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function toFloatOrNull(v) {
  v = emptyToNull(v);
  if (v === null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function normalizePickupDatetime(v) {
  v = emptyToNull(v);
  if (v === null) return null;
  // Accept ISO strings, or "YYYY-MM-DD at HH:MM"
  if (typeof v === "string") {
    const s = v.trim();
    if (s.includes(" at ")) {
      const [d, t] = s.split(" at ");
      const isoLike = `${d}T${t.length === 5 ? t + ":00" : t}`;
      const dt = new Date(isoLike);
      if (!Number.isNaN(dt.getTime())) return dt.toISOString();
    }
    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
    return s; // let Postgres try (and error clearly)
  }
  return v;
}

function requiredString(obj, key) {
  const v = emptyToNull(obj?.[key]);
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`Missing required field: ${key}`);
  }
  return v.trim();
}

function optionalString(obj, key) {
  const v = emptyToNull(obj?.[key]);
  return typeof v === "string" ? v.trim() : null;
}

function pickBookingId(row) {
  if (!row || typeof row !== "object") return null;
  return (
    row.id ??
    row.booking_id ??
    row.bookingId ??
    row.uuid ??
    row.reference ??
    row.ref ??
    null
  );
}

function safeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function customerEmailHtml(b, bookingId) {
  const idLine = bookingId ? `<p><b>Booking ID:</b> ${safeHtml(bookingId)}</p>` : "";
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.4">
    <h2>We received your booking request</h2>
    ${idLine}
    <p>Thanks ${safeHtml(b.customer_name)} — we received your request and will confirm shortly.</p>
    <hr/>
    <p><b>Pickup:</b> ${safeHtml(b.pickup_text)}</p>
    <p><b>Dropoff:</b> ${safeHtml(b.dropoff_text)}</p>
    <p><b>Date & time:</b> ${safeHtml(b.pickup_datetime)}</p>
    <p><b>Mode:</b> ${safeHtml(b.mode)}</p>
    ${b.hours ? `<p><b>Hours:</b> ${safeHtml(b.hours)}</p>` : ""}
    ${b.vehicle_key ? `<p><b>Vehicle:</b> ${safeHtml(b.vehicle_key)}</p>` : ""}
    ${b.price_estimate ? `<p><b>Estimate:</b> ${safeHtml(b.currency || "CAD")} ${safeHtml(b.price_estimate)}</p>` : ""}
  </div>`;
}

function adminEmailHtml(b, bookingId) {
  const idLine = bookingId ? `<p><b>Booking ID:</b> ${safeHtml(bookingId)}</p>` : "";
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.4">
    <h2>New booking request</h2>
    ${idLine}
    <p><b>Name:</b> ${safeHtml(b.customer_name)}</p>
    <p><b>Email:</b> ${safeHtml(b.customer_email)}</p>
    <p><b>Phone:</b> ${safeHtml(b.customer_phone)}</p>
    <hr/>
    <p><b>Pickup:</b> ${safeHtml(b.pickup_text)}</p>
    <p><b>Dropoff:</b> ${safeHtml(b.dropoff_text)}</p>
    <p><b>Date & time:</b> ${safeHtml(b.pickup_datetime)}</p>
    <p><b>Mode:</b> ${safeHtml(b.mode)}</p>
    ${b.hours ? `<p><b>Hours:</b> ${safeHtml(b.hours)}</p>` : ""}
    ${b.vehicle_key ? `<p><b>Vehicle:</b> ${safeHtml(b.vehicle_key)}</p>` : ""}
    ${b.price_estimate ? `<p><b>Estimate:</b> ${safeHtml(b.currency || "CAD")} ${safeHtml(b.price_estimate)}</p>` : ""}
    ${b.passengers != null ? `<p><b>Passengers:</b> ${safeHtml(b.passengers)}</p>` : ""}
    ${b.luggage != null ? `<p><b>Luggage:</b> ${safeHtml(b.luggage)}</p>` : ""}
    ${b.notes ? `<p><b>Notes:</b> ${safeHtml(b.notes)}</p>` : ""}
  </div>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = await readJsonBody(req);

    // Required fields (match your booking.html payload)
    const booking = {
      mode: requiredString(body, "mode"),
      pickup_text: requiredString(body, "pickup_text"),
      dropoff_text: requiredString(body, "dropoff_text"),
      pickup_datetime: normalizePickupDatetime(requiredString(body, "pickup_datetime")),

      // Optional fields
      hours: toFloatOrNull(body.hours),
      vehicle_key: optionalString(body, "vehicle_key"),
      price_estimate: toFloatOrNull(body.price_estimate),
      currency: optionalString(body, "currency") || "CAD",

      customer_name: requiredString(body, "customer_name"),
      customer_email: requiredString(body, "customer_email"),
      customer_phone: requiredString(body, "customer_phone"),

      passengers: toIntOrNull(body.passengers),
      luggage: toIntOrNull(body.luggage),
      notes: optionalString(body, "notes"),

      // Track state
      status: optionalString(body, "status") || "pending",
      stripe_session_id: optionalString(body, "stripe_session_id"),
    };

    // Supabase insert
    const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

    const { data: inserted, error } = await supabase
      .from("bookings")
      .insert([booking])
      .select("*")
      .single();

    if (error) {
      // Return rich error so you can see EXACTLY why it failed
      return res.status(500).json({
        error: "Supabase insert failed",
        supabase: {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        },
      });
    }

    const bookingId = pickBookingId(inserted);

    // Send emails (non-blocking to checkout)
    const adminTo = process.env.ADMIN_NOTIFY_EMAIL;
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const resend = new Resend(resendKey);
      const from = process.env.RESEND_FROM || "Mont Tremblant Limo <bookings@monttremblantlimoservices.com>";
      const replyTo = process.env.REPLY_TO_EMAIL || process.env.ADMIN_NOTIFY_EMAIL;

      // customer email
      try {
        await resend.emails.send({
          from,
          to: booking.customer_email,
          reply_to: replyTo || undefined,
          bcc: adminTo || undefined,
          subject: "We received your booking request",
          html: customerEmailHtml(booking, bookingId),
        });
      } catch (e) {
        // ignore email errors
        console.warn("Resend customer email failed", e);
      }

      // admin email (optional)
      if (adminTo) {
        try {
          await resend.emails.send({
            from,
            to: adminTo,
            reply_to: replyTo || undefined,
            subject: "New booking request",
            html: adminEmailHtml(booking, bookingId),
          });
        } catch (e) {
          console.warn("Resend admin email failed", e);
        }
      }
    }

    return res.status(200).json({ ok: true, bookingId, inserted });
  } catch (e) {
    return res.status(500).json({
      error: "Unable to save booking",
      message: e?.message || String(e),
    });
  }
}
