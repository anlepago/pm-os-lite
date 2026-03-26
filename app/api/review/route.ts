import { NextResponse } from "next/server";
import { z } from "zod";
import { PRDSchema } from "@/lib/schemas/prd.schema";
import {
  runReviewPipeline,
  getCachedReport,
  fetchArtifactById,
} from "@/lib/review/pipeline";

// ── Request schema ────────────────────────────────────────────────────────────

/**
 * Accepts either:
 *   { artifactId: string }            — look up from SQLite, respect 24hr cache
 *   { content: PRDArtifact }          — review inline content directly
 *
 * Exactly one of the two must be present.
 */
const RequestSchema = z
  .object({
    artifactId: z.string().min(1).optional(),
    content: PRDSchema.optional(),
  })
  .refine((d) => d.artifactId !== undefined || d.content !== undefined, {
    message: "Provide either artifactId or content",
  });

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // 1. Parse envelope
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const envelope = RequestSchema.safeParse(body);
  if (!envelope.success) {
    return NextResponse.json(
      { error: "Invalid request", details: envelope.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { artifactId, content } = envelope.data;

  try {
    // 2. artifactId path — check cache first, then fetch artifact
    if (artifactId !== undefined) {
      const cached = getCachedReport(artifactId);
      if (cached) {
        return NextResponse.json(
          { ...cached, _source: "cache" },
          { status: 200 }
        );
      }

      // Cache miss — fetch artifact content from DB
      const artifact = fetchArtifactById(artifactId);
      const report = await runReviewPipeline(artifact, artifactId);
      return NextResponse.json(report, { status: 200 });
    }

    // 3. Inline content path — no cache lookup (no stable ID to key on)
    const report = await runReviewPipeline(content!, null);
    return NextResponse.json(report, { status: 200 });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Review pipeline failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── GET — fetch recent reports ────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const artifactId = searchParams.get("artifactId");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "10", 10), 50);

  const { db } = await import("@/lib/db/client");

  const rows = artifactId
    ? db
        .prepare(
          `SELECT id, artifact_id, timestamp, quality_score, recommendation, blocked, created_at
           FROM review_reports WHERE artifact_id = ? ORDER BY created_at DESC LIMIT ?`
        )
        .all(artifactId, limit)
    : db
        .prepare(
          `SELECT id, artifact_id, timestamp, quality_score, recommendation, blocked, created_at
           FROM review_reports ORDER BY created_at DESC LIMIT ?`
        )
        .all(limit);

  return NextResponse.json(
    (rows as Record<string, unknown>[]).map((r) => ({
      ...r,
      blocked: r.blocked === 1,
    }))
  );
}
