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

    const {
      name,
      email,
      phone,
      pickup_location,
      dropoff_location,
      vehicle,
      price,
      passengers,
      luggage,
      notes
    } = req.body;

    const { data, error } = await supabase
      .from('bookings')
      .insert([{
        name,
        email,
        phone,
        pickup_location,
        dropoff_location,
        vehicle,
        price,
        passengers,
        luggage,
        notes,
        payment_status: 'unpaid'
      }])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      booking_id: data.id
    });

  } catch (err) {
    console.error("API crash:", err);
    return res.status(500).json({ error: err.message });
  }
}
