if (!db.getSiblingDB("admin").auth("rp_admin", fs.readFileSync("/rp-secrets/root-password", "utf8").trim())) quit(1);
try { rs.status(); }
catch (error) {
  if (error.code !== 94) throw error;
  rs.initiate({ _id: "rp-rs", members: [{ _id: 0, host: "mongo:27017" }] });
}
if (!db.hello().isWritablePrimary) quit(1);
