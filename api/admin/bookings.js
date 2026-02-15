const { createClient } = require("@supabase/supabase-js");

function isAdmin(req){
  const cookie = req.headers.cookie || "";
  return cookie.split(";").map(s=>s.trim()).includes("admin=1");
}

function getEnv(name){
  const v = process.env[name];
  if(!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function readJson(req){
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch(e){ reject(e); }
    });
  });
}

module.exports = async (req, res) => {
  if (!isAdmin(req)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ ok:false, error:"Unauthorized" }));
  }

  const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

  try {
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const status = url.searchParams.get("status");
      const limit = Math.min(Number(url.searchParams.get("limit")||"200"), 500);

      let q = supabase.from("bookings").select("*").order("created_at", { ascending: false }).limit(limit);
      if (status) q = q.eq("status", status);

      const { data, error } = await q;
      if (error) throw error;

      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok:true, data }));
    }

    if (req.method === "PATCH") {
      const body = await readJson(req);
      const { id, status, assigned_driver, internal_notes, price_final } = body || {};
      if (!id) throw new Error("Missing id");

      const patch = {};
      if (status) patch.status = status;
      if (assigned_driver !== undefined) patch.assigned_driver = assigned_driver;
      if (internal_notes !== undefined) patch.internal_notes = internal_notes;
      if (price_final !== undefined) patch.price_final = price_final;

      const { data, error } = await supabase.from("bookings").update(patch).eq("id", id).select("*").single();
      if (error) throw error;

      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok:true, data }));
    }

    res.statusCode = 405;
    res.end("Method Not Allowed");
  } catch (e) {
    res.statusCode = 400;
    res.setHeader("Content-Type","application/json");
    res.end(JSON.stringify({ ok:false, error: e?.message || "Unknown error" }));
  }
};
