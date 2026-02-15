module.exports = async (req, res) => {
  res.statusCode = 302;
  res.setHeader("Set-Cookie", "admin=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  res.setHeader("Location", "/admin/");
  res.end();
};
