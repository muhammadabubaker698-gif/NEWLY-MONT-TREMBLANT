// api/bookings.js
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

// Small helper: Vercel sometimes gives req.body as string
function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function safeStr(x) {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  return s.length ? s : null;
}

function safeNum(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function safeBool(x) {
  if (x === true || x === false) return x;
  if (x === 1 || x === 0) return Boolean(x);
  if (typeof x === "string") {
    const v = x.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(v)) return true;
    if (["false", "0", "no", "n"].includes(v)) return false;
  }
  return null;
}

function safeDate(x) {
  // expects ISO or something parseable
  if (!x) return null;
  const d = new Date(x);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function formatMoney(amount, currency) {
  const a = Number(amount);
  if (!Number.isFinite(a)) return `${currency || "CAD"} ${amount}`;
  return `${(currency || "CAD").toUpperCase()}$${a.toFixed(0)}`;
}

module.exports = async function handler(req, res) {
  try {
    // Allow a simple ping to verify wiring
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, route: "/api/bookings" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = readBody(req);

    // Required
    const booking_id = safeStr(body.booking_id) || safeStr(body.id);
    const customer_name = safeStr(body.customer_name);
    const customer_email = safeStr(body.customer_email);
    const customer_phone = safeStr(body.customer_phone);

    if (!booking_id) throw new Error("Missing booking_id");
    if (!customer_name) throw new Error("Missing customer_name");
    if (!customer_email) throw new Error("Missing customer_email");

    // Optional fields (match what your frontend sends)
    const pickup = safeStr(body.pickup);
    const dropoff = safeStr(body.dropoff);
    const passengers = safeNum(body.passengers);
    const luggage = safeNum(body.luggage);
    const notes = safeStr(body.notes);

    const mode = safeStr(body.mode); // one_way / hourly
    const hours = safeNum(body.hours);

    const pickup_datetime =
      safeDate(body.pickup_datetime) ||
      safeDate(body.trip_datetime) ||
      safeDate(body.datetime);

    const trip_date = safeStr(body.trip_date);
    const trip_time = safeStr(body.trip_time);

    const price_estimate =
      safeNum(body.price_estimate) ??
      safeNum(body.estimated_total) ??
      safeNum(body.amount);

    const currency = safeStr(body.currency) || "CAD";
    const vehicle_key = safeStr(body.vehicle_key) || safeStr(body.vehicle);

    const duration_s = safeNum(body.duration_s);
    const distance_m = safeNum(body.distance_m);

    const pickup_lat = safeNum(body.pickup_lat);
    const pickup_lng = safeNum(body.pickup_lng);
    const dropoff_lat = safeNum(body.dropoff_lat);
    const dropoff_lng = safeNum(body.dropoff_lng);

    const dropoff_airport = safeBool(body.dropoff_airport);

    // Payment fields
    const payment_status = safeStr(body.payment_status) || "unpaid";
    const stripe_session_id = safeStr(body.stripe_session_id);
    const stripe_payment_intent = safeStr(body.stripe_payment_intent);

    // --- Supabase insert ---
    const supabaseUrl = mustEnv("SUPABASE_URL");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    // IMPORTANT: Only include columns that exist in your DB.
    // If a column doesn't exist, Supabase will error. So keep this list aligned with your table.
    const row = {
      id: booking_id,

      customer_name,
      customer_email,
      customer_phone,

      pickup,
      dropoff,
      passengers,
      luggage,
      notes,

      mode,
      hours,

      pickup_datetime,
      trip_date,
      trip_time,

      price_estimate,
      currency,
      vehicle_key,

      duration_s,
      distance_m,
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng,
      dropoff_airport,

      payment_status,
      stripe_session_id,
      stripe_payment_intent,
    };

    // Remove undefined keys (but keep null)
    Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);

    const { data: inserted, error: insertErr } = await supabase
      .from("bookings")
      .upsert(row, { onConflict: "id" })
      .select("*")
      .single();

    if (insertErr) throw new Error(`Supabase insert failed: ${insertErr.message}`);

    // --- Emails (Resend) ---
    const resendKey = mustEnv("RESEND_API_KEY");
    const resend = new Resend(resendKey);

    const siteUrl = process.env.SITE_URL || "https://monttremblantlimoservices.com";
    const adminTo =
      process.env.ADMIN_NOTIFY_EMAIL ||
      process.env.ADMIN_NOTIFY_EMAI || // support your current typo too
      null;

    const fromEmail =
      process.env.RESEND_FROM ||
      "Mont Tremblant Limo <onboarding@resend.dev>"; // works even without domain verification

    const subjectCustomer = "We received your booking request";
    const subjectAdmin = `New booking request (${booking_id})`;

    const whenLine =
      pickup_datetime
        ? new Date(pickup_datetime).toLocaleString("en-CA", { hour12: true })
        : [trip_date, trip_time].filter(Boolean).join(" ");

    const priceLine = price_estimate ? formatMoney(price_estimate, currency) : null;

    const htmlSummary = `
      <h2>Booking received ✅</h2>
      <p><b>Name:</b> ${customer_name}</p>
      <p><b>Email:</b> ${customer_email}</p>
      <p><b>Phone:</b> ${customer_phone || "-"}</p>
      <hr/>
      <p><b>Pickup:</b> ${pickup || "-"}</p>
      <p><b>Dropoff:</b> ${dropoff || "-"}</p>
      <p><b>Date/Time:</b> ${whenLine || "-"}</p>
      <p><b>Vehicle:</b> ${vehicle_key || "-"}</p>
      ${priceLine ? `<p><b>Estimated price:</b> ${priceLine}</p>` : ""}
      <p><b>Mode:</b> ${mode || "-"}</p>
      ${hours ? `<p><b>Hours:</b> ${hours}</p>` : ""}
      <p><b>Passengers:</b> ${passengers ?? "-"}</p>
      <p><b>Luggage:</b> ${luggage ?? "-"}</p>
      <p><b>Notes:</b> ${notes || "-"}</p>
      <hr/>
      <p><b>Booking ID:</b> ${booking_id}</p>
      <p><b>Payment status:</b> ${payment_status}</p>
      <p><a href="${siteUrl}">${siteUrl}</a></p>
    `;

    // Customer email
    await resend.emails.send({
      from: fromEmail,
      to: customer_email,
      subject: subjectCustomer,
      html: htmlSummary,
    });

    // Admin/provider email
    if (adminTo) {
      await resend.emails.send({
        from: fromEmail,
        to: adminTo,
        subject: subjectAdmin,
        html: htmlSummary,
      });
    }

    return res.status(200).json({
      ok: true,
      booking_id,
      inserted_id: inserted?.id || booking_id,
    });
  } catch (e) {
    console.error("BOOKINGS ERROR:", e);
    return res.status(500).json({ ok: false, error: e.message || "Unknown error" });
  }
};
