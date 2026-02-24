const Database = require("better-sqlite3");
const db = new Database("ponto.db");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("Tables:", tables.map(t=>t.name).join(", "));
tables.forEach(t => {
  const cols = db.prepare("PRAGMA table_info(" + t.name + ")").all();
  console.log(t.name + ":", cols.map(c=>c.name).join(", "));
  const count = db.prepare("SELECT COUNT(*) as cnt FROM " + t.name).get();
  console.log("  rows:", count.cnt);
});
db.close();
