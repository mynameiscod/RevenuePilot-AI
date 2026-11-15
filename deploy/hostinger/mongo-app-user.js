// Official Mongo image runs this once on an empty, loopback-only init database.
db.getSiblingDB("revenuepilot").createUser({
  user: "revenuepilot",
  pwd: fs.readFileSync("/run/rp-mongo/app-password", "utf8").trim(),
  roles: [{ role: "readWrite", db: "revenuepilot" }],
});
