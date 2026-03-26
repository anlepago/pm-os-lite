/**
 * Reviewer agent — evaluates a PRD or artifact for quality, completeness,
 * and clarity using Claude. Returns a structured ReviewResult.
 */
import { anthropic, DEFAULT_MODEL } from "./client";
import { artifactQueries, prdQueries, reviewQueries } from "@/lib/db/queries";
import {
  ReviewResultSchema,
  type ReviewRequest,
  type ReviewResult,
} from "@/lib/schemas/review";

const SYSTEM_PROMPT = `You are a senior product manager and technical writer reviewing product artifacts.
Evaluate the provided artifact for:
- Completeness (are all necessary sections present?)
- Clarity (is it unambiguous and easy to understand?)
- Testability (can acceptance criteria be verified?)
- Consistency (does it contradict itself?)
- Feasibility (are the requirements realistic?)

Return ONLY a JSON object matching this schema:
{
  "score": number (0-10, where 10 is excellent),
  "summary": string (2-3 sentence executive summary),
  "issues": [
    { "severity": "critical"|"major"|"minor"|"info", "title": string, "description": string }
  ],
  "suggestions": [string]
}`;

export async function reviewArtifact(request: ReviewRequest): Promise<ReviewResult> {
  let content = request.content ?? "";
  let title = request.title ?? "Untitled";

  if (request.artifact_id) {
    const artifact = artifactQueries.findById(request.artifact_id);
    if (!artifact) throw new Error(`Artifact ${request.artifact_id} not found`);
    content = artifact.content;
    title = artifact.title;
  } else if (request.prd_id) {
    const prd = prdQueries.findById(request.prd_id);
    if (!prd) throw new Error(`PRD ${request.prd_id} not found`);
    content = prd.content;
    title = prd.title;
  }

  const userMessage = [
    `## Artifact: ${title}`,
    request.context ? `\n### Context\n${request.context}` : "",
    `\n### Content\n${content}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  // Extract JSON from the response (handle markdown code fences)
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, rawText];
  const parsed = ReviewResultSchema.parse(JSON.parse(jsonMatch[1].trim()));

  // Persist to DB if we have a real artifact/prd ID
  if (request.artifact_id || request.prd_id) {
    reviewQueries.create({
      artifact_id: request.artifact_id ?? null,
      prd_id: request.prd_id ?? null,
      agent: "reviewer",
      score: parsed.score,
      summary: parsed.summary,
      issues: parsed.issues as unknown as string[],
      suggestions: parsed.suggestions,
      raw_output: rawText,
    });
  }

  return parsed;
}
