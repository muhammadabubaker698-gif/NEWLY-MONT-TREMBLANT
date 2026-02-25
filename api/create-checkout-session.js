import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY in environment variables' });
    return;
  }

  const stripe = new Stripe(secret, { apiVersion: '2024-06-20' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const amount = Number(body.amount);
    const currency = (body.currency || 'cad').toLowerCase();
    const bookingId = body.bookingId || '';
    const customerEmail = body.customerEmail || body.email || '';

    // Basic sanity checks (prevents weird values)
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }
    // Cap to something reasonable to prevent abuse; adjust as needed
    if (amount > 20000) {
      res.status(400).json({ error: 'Amount too large' });
      return;
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customerEmail || undefined,
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: 'Mont Tremblant Limo — Booking Deposit',
              description: bookingId ? `Booking ID: ${bookingId}` : undefined,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/booking.html?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/booking.html?payment=cancelled`,
      metadata: {
        bookingId,
      },
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe session error:', err);
    res.status(500).json({ error: err?.message || 'Failed to create Stripe session' });
  }
}
