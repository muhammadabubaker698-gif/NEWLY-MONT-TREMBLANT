module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405; return res.end("Method Not Allowed");
  }
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    const params = new URLSearchParams(body);
    const password = params.get("password") || "";
    const expected = process.env.ADMIN_PASSWORD || "";
    const redirect = "/admin/";
    if (!expected || password !== expected) {
      res.statusCode = 302;
      res.setHeader("Location", redirect + "?err=1");
      return res.end();
    }
    // Set httpOnly cookie
    res.statusCode = 302;
    res.setHeader("Set-Cookie", "admin=1; Path=/; HttpOnly; Secure; SameSite=Lax");
    res.setHeader("Location", redirect);
    res.end();
  });
};
