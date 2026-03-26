import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  validateArtifact,
  isKnownArtifactType,
  type ValidationResult,
} from "@/lib/validators/artifact-validator";

// ── Ensure the validation_results table exists ────────────────────────────────
// Lazy-init so the route works even if `db:init` hasn't been run yet.
db.exec(`
  CREATE TABLE IF NOT EXISTS validation_results (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_type      TEXT NOT NULL,
    valid              INTEGER NOT NULL,
    completeness_score REAL NOT NULL,
    errors             TEXT NOT NULL DEFAULT '[]',
    field_coverage     TEXT NOT NULL DEFAULT '{}',
    raw_content        TEXT NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ── Persist ───────────────────────────────────────────────────────────────────

function persistResult(
  artifactType: string,
  content: unknown,
  result: ValidationResult
): number {
  const stmt = db.prepare(`
    INSERT INTO validation_results
      (artifact_type, valid, completeness_score, errors, field_coverage, raw_content)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const { lastInsertRowid } = stmt.run(
    artifactType,
    result.valid ? 1 : 0,
    result.completenessScore,
    JSON.stringify(result.errors),
    JSON.stringify(result.fieldCoverage),
    JSON.stringify(content)
  );

  return lastInsertRowid as number;
}

// ── Request schema ────────────────────────────────────────────────────────────

const RequestBodySchema = z.object({
  artifactType: z.string(),
  content: z.record(z.unknown()),
});

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // 1. Parse and validate the request envelope
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  const envelope = RequestBodySchema.safeParse(body);
  if (!envelope.success) {
    return NextResponse.json(
      {
        error: "Invalid request shape",
        details: envelope.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { artifactType, content } = envelope.data;

  // 2. Reject unknown artifact types with a helpful message
  if (!isKnownArtifactType(artifactType)) {
    return NextResponse.json(
      {
        error: `Unknown artifactType "${artifactType}". Must be one of: prd, okr, brief`,
      },
      { status: 400 }
    );
  }

  // 3. Run validation — never throws, always returns a structured result
  const result = validateArtifact(artifactType, content);

  // 4. Persist to SQLite
  let savedId: number | undefined;
  try {
    savedId = persistResult(artifactType, content, result);
  } catch (err) {
    // DB write failure is non-fatal — return the validation result anyway
    console.error("[validate] Failed to persist result:", err);
  }

  // 5. Return 200 regardless of valid/invalid — client decides how to surface errors
  return NextResponse.json(
    {
      ...result,
      // Include metadata so clients can retrieve the stored result later
      meta: {
        artifactType,
        savedId: savedId ?? null,
        timestamp: new Date().toISOString(),
      },
    },
    { status: 200 }
  );
}

// ── GET recent results ────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const artifactType = searchParams.get("artifactType");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 100);

  const rows = artifactType
    ? db
        .prepare(
          `SELECT id, artifact_type, valid, completeness_score, errors, field_coverage, created_at
           FROM validation_results
           WHERE artifact_type = ?
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(artifactType, limit)
    : db
        .prepare(
          `SELECT id, artifact_type, valid, completeness_score, errors, field_coverage, created_at
           FROM validation_results
           ORDER BY created_at DESC
           LIMIT ?`
        )
        .all(limit);

  // Parse JSON columns back to objects before returning
  const results = (rows as Record<string, unknown>[]).map((row) => ({
    ...row,
    valid: row.valid === 1,
    errors: JSON.parse(row.errors as string),
    field_coverage: JSON.parse(row.field_coverage as string),
  }));

  return NextResponse.json(results);
}
