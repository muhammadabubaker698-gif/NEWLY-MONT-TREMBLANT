// /api/stripe-webhook.js (ESM)
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export const config = {
  api: {
    bodyParser: false, // IMPORTANT for Stripe signature verification
  },
};

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function safe(s) {
  return String(s ?? '').replace(/[<>]/g, '');
}

function moneyFromStripe(session) {
  const currency = (session.currency || 'cad').toUpperCase();
  const cents = Number(session.amount_total || 0);
  const dollars = (cents / 100).toFixed(2);
  return `${currency}$${dollars}`;
}

function paidCustomerHtml(b, bookingId, session) {
  return `
  <div style="font-family:Arial,sans-serif;line-height:1.55">
    <h2>Payment received ✅</h2>
    <p>Hi ${safe(b.customer_name || 'there')},</p>
    <p>We received your payment for booking <b>${safe(bookingId)}</b>.</p>
    <p><b>Paid:</b> ${safe(moneyFromStripe(session))}</p>
    <hr/>
    <p><b>Pickup:</b> ${safe(b.pickup_text || '-')}</p>
    ${b.mode === 'one_way' ? `<p><b>Dropoff:</b> ${safe(b.dropoff_text || '-')}</p>` : ''}
    <p><b>Date/Time:</b> ${safe(b.pickup_datetime || '-')}</p>
    ${b.mode === 'hourly' ? `<p><b>Hours:</b> ${safe(b.hours ?? '-') }</p>` : ''}
    <p><b>Vehicle:</b> ${safe(b.vehicle_key || '-')}</p>
    <hr/>
    <p>Thank you! If anything changes, reply to this email.</p>
  </div>`;
}

function paidAdminHtml(b, bookingId, session) {
  return `
  <div style="font-family:Arial,sans-serif;line-height:1.55">
    <h2>Payment received 🔔</h2>
    <p><b>Booking ID:</b> ${safe(bookingId)}</p>
    <p><b>Paid:</b> ${safe(moneyFromStripe(session))}</p>
    <p><b>Stripe session:</b> ${safe(session.id)}</p>
    <hr/>
    <p><b>Name:</b> ${safe(b.customer_name || '-')}</p>
    <p><b>Email:</b> ${safe(b.customer_email || '-')}</p>
    <p><b>Phone:</b> ${safe(b.customer_phone || '-')}</p>
    <hr/>
    <p><b>Pickup:</b> ${safe(b.pickup_text || '-')}</p>
    ${b.mode === 'one_way' ? `<p><b>Dropoff:</b> ${safe(b.dropoff_text || '-')}</p>` : ''}
    <p><b>Date/Time:</b> ${safe(b.pickup_datetime || '-')}</p>
    ${b.mode === 'hourly' ? `<p><b>Hours:</b> ${safe(b.hours ?? '-') }</p>` : ''}
    <p><b>Vehicle:</b> ${safe(b.vehicle_key || '-')}</p>
  </div>`;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const stripe = new Stripe(getEnv('STRIPE_SECRET_KEY'));

    const buf = await readRawBody(req);
    const sig = req.headers['stripe-signature'];
    if (!sig) return res.status(400).send('Missing stripe-signature');

    const event = stripe.webhooks.constructEvent(
      buf,
      sig,
      getEnv('STRIPE_WEBHOOK_SECRET')
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      const bookingId =
        session.metadata?.booking_id ||
        session.metadata?.bookingId ||
        session.client_reference_id ||
        null;

      if (bookingId) {
        const supabase = createClient(
          getEnv('SUPABASE_URL'),
          getEnv('SUPABASE_SERVICE_ROLE_KEY'),
          {
            auth: { persistSession: false, autoRefreshToken: false },
          }
        );

        // Mark booking paid
        const { error: updErr } = await supabase
          .from('bookings')
          .update({
            payment_status: 'paid',
            stripe_session_id: session.id,
            stripe_payment_intent: session.payment_intent || null,
          })
          .eq('id', bookingId);

        if (updErr) throw updErr;

        // Fetch booking for emails
        const { data: booking, error: selErr } = await supabase
          .from('bookings')
          .select(
            'id, mode, pickup_text, dropoff_text, pickup_datetime, hours, vehicle_key, customer_name, customer_email, customer_phone'
          )
          .eq('id', bookingId)
          .single();

        if (selErr) throw selErr;

        const resend = new Resend(getEnv('RESEND_API_KEY'));

        const from =
          process.env.RESEND_FROM ||
          'Mont Tremblant Limo <bookings@monttremblantlimoservices.com>';

        const replyTo =
          process.env.REPLY_TO_EMAIL ||
          'muhammadabubaker698@gmail.com';

        const adminTo = process.env.ADMIN_NOTIFY_EMAIL;

        if (booking?.customer_email) {
          await resend.emails.send({
            from,
            to: booking.customer_email,
            reply_to: replyTo,
            subject: 'Payment received — Mont Tremblant Limo',
            html: paidCustomerHtml(booking, bookingId, session),
          });
        }

        if (adminTo) {
          await resend.emails.send({
            from,
            to: adminTo,
            reply_to: replyTo,
            subject: `Payment received — Booking ${bookingId}`,
            html: paidAdminHtml(booking, bookingId, session),
          });
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('STRIPE WEBHOOK ERROR:', err);
    return res.status(400).send(`Webhook Error: ${err?.message || String(err)}`);
  }
}
