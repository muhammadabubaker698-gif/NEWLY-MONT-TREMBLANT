// /api/create-checkout-session.js  (ESM)
// Creates a Stripe Checkout Session for a booking.
import Stripe from 'stripe';

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const bookingId = body?.bookingId || body?.booking_id;
    const amountCad = Number(body?.amount_cad ?? body?.amount ?? 0);

    if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });
    if (!Number.isFinite(amountCad) || amountCad <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const stripe = new Stripe(getEnv('STRIPE_SECRET_KEY'));

    const siteUrl = process.env.SITE_URL || 'https://monttremblantlimoservices.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'cad',
            product_data: {
              name: 'Mont Tremblant Limo — Booking Payment',
            },
            unit_amount: Math.round(amountCad * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/booking-success.html?bookingId=${encodeURIComponent(bookingId)}`,
      cancel_url: `${siteUrl}/booking-cancelled.html?bookingId=${encodeURIComponent(bookingId)}`,
      metadata: { booking_id: String(bookingId) },
      client_reference_id: String(bookingId),
    });

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    console.error('CREATE CHECKOUT SESSION ERROR:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
