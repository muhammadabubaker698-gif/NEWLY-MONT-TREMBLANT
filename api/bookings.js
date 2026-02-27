// /api/bookings.js (Vercel Serverless Function)
// ESM module syntax (works when your project uses "type": "module")

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

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

  pickup_datetime: z.string().min(5), // ISO string from client
  hours: z.number().int().positive().optional().nullable(),

  vehicle_key: z.string().min(1),

  estimate_cents: z.number().int().nonnegative(),
  currency: z.string().default("cad"),

  customer_name: z.string().min(1),
  customer_email: z.string().email(),
  customer_phone: z.string().min(6),

  passengers: z.number().int().nonnegative().optional().nullable(),
  luggage: z.number().int().nonnegative().optional().nullable(),
  notes: z.string().optional().nullable(),
});

function json(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  // CORS (safe default)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return json(res, 200, { ok: true });

  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  try {
    const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    // Vercel usually parses JSON body automatically. Still guard it.
    const rawBody = req.body ?? {};
    const parsed = BookingSchema.safeParse(rawBody);
    if (!parsed.success) {
      return json(res, 400, {
        error: "Invalid booking payload",
        details: parsed.error.issues,
      });
    }

    const b = parsed.data;

    // Insert and return the new booking id
    const { data, error } = await supabase
      .from("bookings")
      .insert([
        {
          ...b,
          // store as timestamptz (Supabase/Postgres will parse ISO)
          pickup_datetime: b.pickup_datetime,
          payment_status: "unpaid",
        },
      ])
      .select("id")
      .single();

    if (error) {
      // IMPORTANT: return the real DB error to the browser (so you can debug quickly)
      return json(res, 500, {
        error: "Supabase insert failed",
        supabase: {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        },
      });
    }

    return json(res, 200, { ok: true, id: data.id });
  } catch (e) {
    console.error("/api/bookings fatal:", e);
    return json(res, 500, { error: "Server error", message: String(e?.message || e) });
  }
}
