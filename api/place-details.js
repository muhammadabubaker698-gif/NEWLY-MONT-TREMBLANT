export default async function handler(req, res) {
  const placeId = (req.query.placeId || "").toString().trim();
  if (!placeId) return res.status(400).json({ error: "placeId required" });

  const key = process.env.GOOGLE_PLACES_SERVER_KEY;
  if (!key) return res.status(500).json({ error: "Missing GOOGLE_PLACES_SERVER_KEY" });

  const url =
    "https://maps.googleapis.com/maps/api/place/details/json" +
    `?place_id=${encodeURIComponent(placeId)}` +
    `&fields=name,formatted_address,geometry` +
    `&key=${encodeURIComponent(key)}`;

  const r = await fetch(url);
  const data = await r.json();

  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
  res.status(200).json(data);
}
