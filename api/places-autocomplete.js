export default async function handler(req, res) {
  const q = (req.query.q || "").toString().trim();
  if (q.length < 2) return res.status(200).json({ predictions: [] });

  const key = process.env.GOOGLE_PLACES_SERVER_KEY;
  if (!key) return res.status(500).json({ error: "Missing GOOGLE_PLACES_SERVER_KEY" });

  // Bias around Montreal, but still allow broader QC results
  const url =
    "https://maps.googleapis.com/maps/api/place/autocomplete/json" +
    `?input=${encodeURIComponent(q)}` +
    `&key=${encodeURIComponent(key)}` +
    `&components=country:ca` +
    `&location=45.5017,-73.5673` +
    `&radius=80000`;

  const r = await fetch(url);
  const data = await r.json();

  // Vercel CDN cache (fast repeats)
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
  res.status(200).json(data);
}
