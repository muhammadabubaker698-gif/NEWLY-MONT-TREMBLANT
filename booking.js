import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {

    const booking = req.body

    const { data, error } = await supabase
      .from('bookings')
      .insert([booking])
      .select()
      .single()

    if (error) {
      console.error(error)
      return res.status(500).json({ error: error.message })
    }

    return res.status(200).json({
      success: true,
      booking: data
    })

  } catch (err) {

    console.error(err)

    return res.status(500).json({
      error: err.message
    })
  }
}
