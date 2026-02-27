// api/bookings.js  (ESM)
// No dependencies. Uses native fetch to Supabase REST.
// Required env vars on Vercel:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL) return res.status(500).json({ error: "Missing SUPABASE_URL" });
    if (!SERVICE_KEY) return res.status(500).json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" });

    // Vercel usually parses JSON body for you; fallback for safety
    const booking = (req.body && typeof req.body === "object") ? req.body : {};

    const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/bookings`;

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Prefer": "return=representation",
      },
      body: JSON.stringify(booking),
    });

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    if (!r.ok) {
      return res.status(400).json({
        error: "Supabase insert failed",
        status: r.status,
        details: data || text,
      });
    }

    const inserted = Array.isArray(data) ? data[0] : data;
    return res.status(200).json({ ok: true, booking: inserted });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}