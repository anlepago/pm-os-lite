/**
 * migrate-db.js
 * Drops the legacy artifacts table and re-applies the full schema.
 * Run with: node scripts/migrate-db.js
 */
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "pm-os.db");
const SCHEMA_PATH = path.join(__dirname, "..", "lib", "db", "schema.sql");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF");

// Inspect current state
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("Existing tables:", tables.map(t => t.name).join(", "));

const artifactCols = db.prepare("PRAGMA table_info(artifacts)").all();
console.log("artifacts columns:", artifactCols.length ? artifactCols.map(c => c.name).join(", ") : "(none)");

// Drop tables that need to be recreated with the new schema
const toDrop = ["artifacts", "reviews", "okr_baselines", "drift_signal_cache", "drift_comparison_cache", "review_reports", "validation_results"];
for (const t of toDrop) {
  db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  console.log(`Dropped: ${t}`);
}

// Re-apply full schema
const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
db.exec(schema);
console.log("Schema applied successfully.");

// Verify new artifacts table
const newCols = db.prepare("PRAGMA table_info(artifacts)").all();
console.log("New artifacts columns:", newCols.map(c => c.name).join(", "));

db.close();
console.log("Done. Database is ready.");
