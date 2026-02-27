// /api/bookings.js  (ESM)
// Creates a booking record in Supabase and returns bookingId.
import { createClient } from '@supabase/supabase-js';

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function parseJsonBody(req) {
  // Vercel may already parse JSON into req.body.
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { /* fallthrough */ }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = parseJsonBody(req);
    if (!body) return res.status(400).json({ error: 'Invalid JSON body' });

    const supabase = createClient(
      getEnv('SUPABASE_URL'),
      // Use service-role key so inserts work without RLS policies.
      getEnv('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );

    // IMPORTANT: Insert as many fields as possible (matches most schemas).
    // If your table has extra NOT NULL columns, add them here.
    const insertRow = {
      mode: body.mode ?? null,
      pickup_text: body.pickup_text ?? null,
      dropoff_text: body.dropoff_text ?? null,
      pickup_datetime: body.pickup_datetime ?? null,
      hours: body.hours ?? null,
      vehicle_key: body.vehicle_key ?? null,

      customer_name: body.customer_name ?? null,
      customer_email: body.customer_email ?? null,
      customer_phone: body.customer_phone ?? null,
      passengers: body.passengers ?? null,
      luggage: body.luggage ?? null,
      notes: body.notes ?? null,

      // optional geo / ids
      pickup_lat: body.pickup_lat ?? null,
      pickup_lng: body.pickup_lng ?? null,
      dropoff_lat: body.dropoff_lat ?? null,
      dropoff_lng: body.dropoff_lng ?? null,
      pickup_place_id: body.pickup_place_id ?? null,
      dropoff_place_id: body.dropoff_place_id ?? null,

      // pricing
      amount_cad: body.amount_cad ?? body.amount ?? null,
      currency: body.currency ?? 'cad',

      payment_status: body.payment_status ?? 'unpaid',
    };

    const { data, error } = await supabase
      .from('bookings')
      .insert(insertRow)
      .select('id')
      .single();

    if (error) {
      console.error('SUPABASE INSERT ERROR:', error);
      return res.status(500).json({
        ok: false,
        error: {
          message: error.message,
          details: error.details ?? null,
          hint: error.hint ?? null,
          code: error.code ?? null,
        },
      });
    }

    const bookingId = data?.id ?? null;
    return res.status(200).json({ ok: true, bookingId });
  } catch (err) {
    console.error('API /bookings FAILED:', err);
    return res.status(500).json({ ok: false, error: { message: err?.message || String(err) } });
  }
}
