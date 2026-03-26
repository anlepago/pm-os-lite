import { NextResponse } from "next/server";
import { z } from "zod";
import { detectDrift, detectHistoricalDrift } from "@/lib/agents/drift-detector";
import { PRDSchema } from "@/lib/schemas/prd.schema";
import { OKRSchema } from "@/lib/schemas/okr.schema";

// ── Request schemas ───────────────────────────────────────────────────────────

/**
 * mode: "okr"      — compare a PRD or Brief against one or more OKRs
 * mode: "history"  — compare a PRD against previous versions of itself
 */
const OKRDriftRequestSchema = z.object({
  mode: z.literal("okr"),
  newArtifact: PRDSchema.or(
    z.object({ artifactType: z.literal("brief") }).passthrough()
  ),
  baselineOKRs: z.array(OKRSchema).min(1, "Provide at least one baseline OKR"),
});

const HistoricalDriftRequestSchema = z.object({
  mode: z.literal("history"),
  newArtifact: PRDSchema,
  previousArtifacts: z.array(PRDSchema).min(1, "Provide at least one previous PRD"),
});

const DriftRequestSchema = z.discriminatedUnion("mode", [
  OKRDriftRequestSchema,
  HistoricalDriftRequestSchema,
]);

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const envelope = DriftRequestSchema.safeParse(body);
  if (!envelope.success) {
    return NextResponse.json(
      { error: "Invalid request", details: envelope.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    if (envelope.data.mode === "okr") {
      const result = await detectDrift(
        envelope.data.newArtifact as Parameters<typeof detectDrift>[0],
        envelope.data.baselineOKRs
      );
      return NextResponse.json(result);
    }

    const result = await detectHistoricalDrift(
      envelope.data.newArtifact,
      envelope.data.previousArtifacts
    );
    return NextResponse.json(result);

  } catch (error) {
    const message = error instanceof Error ? error.message : "Drift detection failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
