import { NextResponse } from "next/server";
import { PRDSchema } from "@/lib/schemas/prd.schema";
import { reviewArtifact } from "@/lib/agents/adversarial-reviewer";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const parsed = PRDSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid PRD artifact", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const review = await reviewArtifact(parsed.data);
    return NextResponse.json(review);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Review failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
