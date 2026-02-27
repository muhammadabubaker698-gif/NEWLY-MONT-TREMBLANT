import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const body = req.body;

    const { data, error } = await supabase
      .from('bookings')
      .insert([{
        name: body.name,
        phone: body.phone,
        email: body.email,
        passengers: body.passengers || null,
        luggage: body.luggage || null,
        notes: body.notes || null,
        pickup_address: body.pickup_address || null,
        dropoff_address: body.dropoff_address || null,
        payment_status: 'unpaid'
      }])
      .select()
      .single();

    if (error) {
      console.error(error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      booking_id: data.id
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: err.message
    });

  }

}
