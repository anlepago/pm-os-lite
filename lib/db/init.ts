/**
 * Database initializer — run with: npx tsx lib/db/init.ts
 * Creates all tables and seeds sample data if the DB is empty.
 */
import { db } from "./client";
import fs from "fs";
import path from "path";

const sqlPath = path.join(process.cwd(), "lib", "db", "schema.sql");
const schema = fs.readFileSync(sqlPath, "utf-8");

// Execute all statements in the schema file
db.exec(schema);
console.log("✓ Schema applied");

// Seed sample data only if products table is empty
const count = (db.prepare("SELECT COUNT(*) as n FROM products").get() as { n: number }).n;
if (count === 0) {
  const insertProduct = db.prepare(
    "INSERT INTO products (name, description, owner) VALUES (?, ?, ?)"
  );
  const { lastInsertRowid: productId } = insertProduct.run(
    "Acme Analytics",
    "Self-serve analytics platform for SMBs",
    "alice@acme.com"
  );

  const insertPrd = db.prepare(
    "INSERT INTO prds (product_id, title, content, status) VALUES (?, ?, ?, ?)"
  );
  const { lastInsertRowid: prdId } = insertPrd.run(
    productId,
    "Q3 Dashboard Revamp",
    fs.existsSync(path.join(process.cwd(), "data", "sample-prd.md"))
      ? fs.readFileSync(path.join(process.cwd(), "data", "sample-prd.md"), "utf-8")
      : "## Overview\nRevamp the analytics dashboard for improved usability.",
    "review"
  );

  const insertArtifact = db.prepare(
    "INSERT INTO artifacts (prd_id, type, title, content) VALUES (?, ?, ?, ?)"
  );
  insertArtifact.run(prdId, "ticket", "DASH-101: Add date range picker", "Implement a date range picker component on the main dashboard view.");
  insertArtifact.run(prdId, "spec", "Dashboard layout spec", "The dashboard must support at least 6 widgets arranged in a responsive grid.");

  // Seed some metrics
  const insertMetric = db.prepare(
    "INSERT INTO metrics (product_id, metric, value, recorded_at) VALUES (?, ?, ?, ?)"
  );
  const base = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    insertMetric.run(productId, "dau", Math.round(800 + Math.random() * 400), iso);
    insertMetric.run(productId, "tickets_open", Math.round(10 + Math.random() * 20), iso);
  }

  console.log("✓ Sample data seeded");
} else {
  console.log("ℹ  Database already has data — skipping seed");
}

console.log("✓ Database ready");
