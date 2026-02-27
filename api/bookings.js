// api/bookings.js (Vercel Serverless Function - ESM)
// IMPORTANT: Your project appears to be running in ESM ("type": "module").
// This file uses ESM syntax and `export default`.

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // CORS (safe defaults)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  return await new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") return json(res, 200, { ok: true });
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const RESEND_FROM = process.env.RESEND_FROM;
    const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || RESEND_FROM;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, {
        error: "Server misconfigured",
        details: { message: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
      });
    }

    const body = await readJson(req);

    // Minimal validation (keep it permissive to avoid breaking)
    const required = ["name", "phone", "email", "pickup_text"];
    for (const k of required) {
      if (!body?.[k] || String(body[k]).trim().length < 2) {
        return json(res, 400, { error: `Missing field: ${k}` });
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // IMPORTANT: Table is `public.bookings` in your screenshots, so we insert into "bookings".
    // If your table name is different, change it here.
    const insertRow = {
      // core
      name: String(body.name).trim(),
      phone: String(body.phone).trim(),
      email: String(body.email).trim(),
      mode: body.mode || "one_way",

      // route
      pickup_text: body.pickup_text ?? null,
      dropoff_text: body.dropoff_text ?? null,
      pickup_lat: body.pickup_lat ?? null,
      pickup_lng: body.pickup_lng ?? null,
      dropoff_lat: body.dropoff_lat ?? null,
      dropoff_lng: body.dropoff_lng ?? null,

      // booking details
      pickup_date: body.pickup_date ?? null,
      pickup_time: body.pickup_time ?? null,
      passengers: body.passengers ?? null,
      luggage: body.luggage ?? null,
      notes: body.notes ?? null,

      // price
      estimate_cad: body.estimate_cad ?? body.estimate ?? null,

      // stripe linkage (optional)
      stripe_session_id: body.stripe_session_id ?? null,
      status: body.status ?? "pending",
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("bookings")
      .insert([insertRow])
      .select("id")
      .single();

    if (error) {
      // Return full Supabase error so booking.html can show it
      return json(res, 500, { error: "Supabase insert failed", details: error });
    }

    // Send email notification (non-fatal)
    let emailWarning = null;
    try {
      if (RESEND_API_KEY && RESEND_FROM && ADMIN_NOTIFY_EMAIL) {
        const resend = new Resend(RESEND_API_KEY);
        await resend.emails.send({
          from: RESEND_FROM,
          to: [ADMIN_NOTIFY_EMAIL],
          subject: "New booking received",
          text: `Booking ID: ${data?.id}\nName: ${insertRow.name}\nPhone: ${insertRow.phone}\nEmail: ${insertRow.email}\nPickup: ${insertRow.pickup_text}\nDropoff: ${insertRow.dropoff_text ?? ""}\nEstimate: ${insertRow.estimate_cad ?? ""}\n`,
        });
      }
    } catch (e) {
      emailWarning = String(e?.message || e);
    }

    return json(res, 200, { ok: true, bookingId: data?.id, emailWarning });
  } catch (e) {
    return json(res, 500, { error: "Server error", details: { message: String(e?.message || e), stack: e?.stack } });
  }
}
