// /api/bookings.js
// Works in both ESM + CommonJS environments because it uses only fetch.
// It inserts into Supabase via REST and returns { ok: true, id, booking }.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return json(res, 405, { error: "Method not allowed" });
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json(res, 500, {
        error: "Missing env vars",
        missing: {
          SUPABASE_URL: !SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY: !SERVICE_ROLE_KEY,
        },
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    // Keep payload flexible. Only send what you have.
    const payload = {
      name: body.name ?? body.full_name ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,

      pickup_text: body.pickup_text ?? body.pickup ?? null,
      dropoff_text: body.dropoff_text ?? body.dropoff ?? null,

      pickup_airport: body.pickup_airport ?? null,
      dropoff_airport: body.dropoff_airport ?? null,

      passengers: body.passengers ?? null,
      luggage: body.luggage ?? null,
      notes: body.notes ?? null,

      mode: body.mode ?? "one_way",
      vehicle: body.vehicle ?? null,

      date: body.date ?? null,
      time: body.time ?? null,

      price: body.price ?? body.amount ?? null,
      currency: body.currency ?? "CAD",

      status: body.status ?? "pending",
      source: body.source ?? "website",
    };

    // Remove null/undefined keys to avoid column mismatch errors
    Object.keys(payload).forEach((k) => (payload[k] == null ? delete payload[k] : null));

    const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/bookings?select=id`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!r.ok) {
      return json(res, 500, {
        error: "Supabase insert failed",
        status: r.status,
        details: data,
      });
    }

    // Supabase returns an array of inserted rows (because return=representation)
    const row = Array.isArray(data) ? data[0] : data;
    const id = row?.id ?? null;

    return json(res, 200, { ok: true, id, booking: row ?? null });
  } catch (e) {
    return json(res, 500, { error: "Server error", message: e?.message || String(e) });
  }
}
