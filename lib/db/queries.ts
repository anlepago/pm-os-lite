/**
 * Typed query helpers — thin wrappers over raw better-sqlite3 statements.
 * No ORM, no magic — just typed results.
 */
import { db } from "./client";
import type { Product, PRD, Artifact, Review, Metric } from "./types";

// ── Products ─────────────────────────────────────────────────────────────────

export const productQueries = {
  findAll(): Product[] {
    return db.prepare("SELECT * FROM products ORDER BY created_at DESC").all() as Product[];
  },

  findById(id: number): Product | undefined {
    return db.prepare("SELECT * FROM products WHERE id = ?").get(id) as Product | undefined;
  },

  create(data: Pick<Product, "name" | "description" | "owner">): Product {
    const result = db
      .prepare("INSERT INTO products (name, description, owner) VALUES (?, ?, ?)")
      .run(data.name, data.description ?? null, data.owner ?? null);
    return productQueries.findById(result.lastInsertRowid as number)!;
  },

  update(id: number, data: Partial<Pick<Product, "name" | "description" | "owner">>): Product | undefined {
    const fields = Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => `${k} = ?`)
      .join(", ");
    const values = Object.values(data).filter((v) => v !== undefined);
    if (!fields) return productQueries.findById(id);
    db.prepare(`UPDATE products SET ${fields} WHERE id = ?`).run(...values, id);
    return productQueries.findById(id);
  },

  delete(id: number): void {
    db.prepare("DELETE FROM products WHERE id = ?").run(id);
  },
};

// ── PRDs ──────────────────────────────────────────────────────────────────────

export const prdQueries = {
  findAll(productId?: number): PRD[] {
    if (productId) {
      return db
        .prepare("SELECT * FROM prds WHERE product_id = ? ORDER BY created_at DESC")
        .all(productId) as PRD[];
    }
    return db.prepare("SELECT * FROM prds ORDER BY created_at DESC").all() as PRD[];
  },

  findById(id: number): PRD | undefined {
    return db.prepare("SELECT * FROM prds WHERE id = ?").get(id) as PRD | undefined;
  },

  create(data: Pick<PRD, "product_id" | "title" | "content" | "status">): PRD {
    const result = db
      .prepare("INSERT INTO prds (product_id, title, content, status) VALUES (?, ?, ?, ?)")
      .run(data.product_id, data.title, data.content, data.status ?? "draft");
    return prdQueries.findById(result.lastInsertRowid as number)!;
  },

  updateStatus(id: number, status: PRD["status"]): void {
    db.prepare("UPDATE prds SET status = ? WHERE id = ?").run(status, id);
  },
};

// ── Artifacts ─────────────────────────────────────────────────────────────────

export const artifactQueries = {
  findByPrd(prdId: number): Artifact[] {
    return db
      .prepare("SELECT * FROM artifacts WHERE prd_id = ? ORDER BY created_at DESC")
      .all(prdId) as Artifact[];
  },

  findById(id: number): Artifact | undefined {
    return db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as Artifact | undefined;
  },

  create(data: Pick<Artifact, "prd_id" | "type" | "title" | "content" | "source_url">): Artifact {
    const result = db
      .prepare(
        "INSERT INTO artifacts (prd_id, type, title, content, source_url) VALUES (?, ?, ?, ?, ?)"
      )
      .run(data.prd_id, data.type, data.title, data.content, data.source_url ?? null);
    return artifactQueries.findById(result.lastInsertRowid as number)!;
  },
};

// ── Reviews ───────────────────────────────────────────────────────────────────

export const reviewQueries = {
  findByArtifact(artifactId: number): Review[] {
    return db
      .prepare("SELECT * FROM reviews WHERE artifact_id = ? ORDER BY created_at DESC")
      .all(artifactId) as Review[];
  },

  findByPrd(prdId: number): Review[] {
    return db
      .prepare("SELECT * FROM reviews WHERE prd_id = ? ORDER BY created_at DESC")
      .all(prdId) as Review[];
  },

  create(data: Omit<Review, "id" | "created_at">): Review {
    const result = db
      .prepare(
        `INSERT INTO reviews (artifact_id, prd_id, agent, score, summary, issues, suggestions, raw_output)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.artifact_id ?? null,
        data.prd_id ?? null,
        data.agent,
        data.score ?? null,
        data.summary,
        JSON.stringify(data.issues ?? []),
        JSON.stringify(data.suggestions ?? []),
        data.raw_output ?? null
      );
    return db.prepare("SELECT * FROM reviews WHERE id = ?").get(result.lastInsertRowid) as Review;
  },
};

// ── Metrics ───────────────────────────────────────────────────────────────────

export const metricQueries = {
  findByProduct(productId: number, metric?: string): Metric[] {
    if (metric) {
      return db
        .prepare(
          "SELECT * FROM metrics WHERE product_id = ? AND metric = ? ORDER BY recorded_at ASC"
        )
        .all(productId, metric) as Metric[];
    }
    return db
      .prepare("SELECT * FROM metrics WHERE product_id = ? ORDER BY recorded_at ASC")
      .all(productId) as Metric[];
  },

  insert(data: Omit<Metric, "id">): void {
    db.prepare(
      "INSERT INTO metrics (product_id, metric, value, recorded_at) VALUES (?, ?, ?, ?)"
    ).run(data.product_id, data.metric, data.value, data.recorded_at ?? new Date().toISOString());
  },
};
