# Mont Tremblant Limo — Static site + Vercel Serverless APIs

## Deploy
1. Push this folder to GitHub.
2. Import project into Vercel.
3. Set env vars in Vercel:
   - SUPABASE_URL
   - SUPABASE_ANON_KEY
   - SUPABASE_SERVICE_ROLE_KEY   (server only)
   - RESEND_API_KEY
   - ADMIN_NOTIFY_EMAIL
   - ADMIN_PASSWORD
   - SITE_URL

## Endpoints
- POST /api/bookings        create booking, save to Supabase, email customer + admin
- POST /api/admin/login     sets admin cookie
- GET  /api/admin/logout    clears admin cookie
- GET  /api/admin/bookings  list bookings (admin cookie required)
- PATCH /api/admin/bookings update status/driver/notes/price_final (admin cookie required)

## Admin
Open /admin/ and log in with ADMIN_PASSWORD.
