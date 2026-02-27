import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

/**
 * Vercel Serverless Function
 * Route: /api/bookings
 *
 * - Saves booking into Supabase table: public.bookings
 * - Sends notification emails (optional; will not block booking save if email fails)
 *
 * Env vars required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 * Optional:
 *   RESEND_API_KEY
 *   RESEND_FROM
 *   ADMIN_NOTIFY_EMAIL
 */
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      res.status(500).json({
        ok: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables",
      });
      return;
    }

    const body = (req.body && typeof req.body === "object") ? req.body : {};

    // Minimal validation (keep it flexible)
    const required = ["name", "phone", "email", "pickup_text"];
    const missing = required.filter((k) => !String(body?.[k] ?? "").trim());
    if (missing.length) {
      res.status(400).json({ ok: false, error: `Missing required fields: ${missing.join(", ")}` });
      return;
    }

    // Normalize a few fields to avoid Supabase type errors
    const bookingToInsert = {
      ...body,
      created_at: body.created_at || new Date().toISOString(),
    };

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabase
      .from("bookings")
      .insert([bookingToInsert])
      .select("*")
      .single();

    if (error) {
      res.status(500).json({ ok: false, error: error.message });
      return;
    }

    const id = data?.id ?? data?.booking_id ?? data?.bookingId ?? null;

    // Try sending emails (do NOT fail the booking if this fails)
    let emailWarning = null;
    try {
      const resendKey = process.env.RESEND_API_KEY;
      const from = process.env.RESEND_FROM;
      const adminEmail = process.env.ADMIN_NOTIFY_EMAIL;

      if (resendKey && from && adminEmail) {
        const resend = new Resend(resendKey);

        const subject = `New booking received${id ? ` (#${id})` : ""}`;
        const plain = [
          "A new booking was submitted:",
          "",
          `ID: ${id ?? "(not available)"}`,
          `Name: ${data?.name ?? ""}`,
          `Phone: ${data?.phone ?? ""}`,
          `Email: ${data?.email ?? ""}`,
          `Mode: ${data?.mode ?? ""}`,
          `Pickup: ${data?.pickup_text ?? ""}`,
          `Dropoff: ${data?.dropoff_text ?? ""}`,
          `Vehicle: ${data?.vehicle ?? ""}`,
          `Estimate: ${data?.estimate_text ?? ""}`,
          "",
          "Full payload:",
          JSON.stringify(data, null, 2),
        ].join("\n");

        await resend.emails.send({
          from,
          to: [adminEmail],
          subject,
          text: plain,
        });
      }
    } catch (e) {
      emailWarning = String(e?.message || e);
    }

    res.status(200).json({
      ok: true,
      id,
      booking: data,
      ...(emailWarning ? { emailWarning } : {}),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
