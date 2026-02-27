Fix Pack (ES Modules) for Vercel /api

Copy these files into your repo (replace existing ones):

- api/bookings.js
- api/create-checkout-session.js
- api/stripe-webhook.js

Why:
- Your Vercel logs showed: "ReferenceError: module is not defined in ES module scope".
  That means your project is running API routes as ES Modules, so you must NOT use
  require() / module.exports.

After deploying:
1) Open https://YOUR_DOMAIN/api/bookings in browser => should return {"error":"Method not allowed"}
2) Try a booking => if it fails, open Vercel Logs for /api/bookings and you'll now see
   the exact Supabase insert error in the JSON response too.
