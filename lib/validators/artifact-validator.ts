import { z, ZodError } from "zod";
import { PRDSchema } from "@/lib/schemas/prd.schema";
import { OKRSchema } from "@/lib/schemas/okr.schema";
import { BriefSchema } from "@/lib/schemas/brief.schema";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
  severity: "hard" | "soft";
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  completenessScore: number;
  fieldCoverage: Record<string, boolean>;
}

// ── Schema registry ───────────────────────────────────────────────────────────

const SCHEMAS = {
  prd: PRDSchema,
  okr: OKRSchema,
  brief: BriefSchema,
} as const;

export type ArtifactTypeName = keyof typeof SCHEMAS;

export function isKnownArtifactType(t: unknown): t is ArtifactTypeName {
  return typeof t === "string" && t in SCHEMAS;
}

// ── Field coverage ────────────────────────────────────────────────────────────

/**
 * Recursively flattens a nested object into dot-notation paths, marking each
 * path as covered (true) or absent/empty (false).
 *
 * Arrays are considered covered if they have at least one element.
 * Strings are considered covered if they have at least one non-whitespace character.
 * Numbers are always covered (0 is a valid value).
 * null / undefined → false.
 */
function flattenCoverage(
  obj: unknown,
  prefix = ""
): Record<string, boolean> {
  if (obj === null || obj === undefined) return { [prefix]: false };

  if (typeof obj === "number" || typeof obj === "boolean") {
    return { [prefix]: true };
  }

  if (typeof obj === "string") {
    return { [prefix]: obj.trim().length > 0 };
  }

  if (Array.isArray(obj)) {
    const covered = obj.length > 0;
    const result: Record<string, boolean> = { [prefix]: covered };
    // Recurse into first element to capture nested array-item field coverage
    if (covered && typeof obj[0] === "object" && obj[0] !== null) {
      const itemCoverage = flattenCoverage(obj[0], `${prefix}[0]`);
      Object.assign(result, itemCoverage);
    }
    return result;
  }

  if (typeof obj === "object") {
    const result: Record<string, boolean> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      Object.assign(result, flattenCoverage(val, path));
    }
    return result;
  }

  return {};
}

// ── Completeness score ────────────────────────────────────────────────────────

/**
 * Scores 0–100 based on:
 * - Base fill rate: what fraction of detected fields have non-empty values
 * - Penalty: -5 per soft error (capped so score never goes below 0)
 *
 * The score is only meaningful for artifacts that pass hard validation.
 * For invalid artifacts it still runs, but the valid:false flag takes precedence.
 */
function computeCompletenessScore(
  coverage: Record<string, boolean>,
  softErrors: ValidationError[]
): number {
  const entries = Object.values(coverage);
  if (entries.length === 0) return 0;

  const filled = entries.filter(Boolean).length;
  const fillRate = Math.round((filled / entries.length) * 100);

  const penalty = softErrors.length * 5;
  return Math.max(0, fillRate - penalty);
}

// ── Soft error rules ──────────────────────────────────────────────────────────

/**
 * Each rule is a predicate over the parsed (or partially-parsed) content.
 * Rules run even on invalid artifacts (using the raw input) so the client
 * always gets completeness feedback alongside hard errors.
 */
type SoftRule = (content: Record<string, unknown>) => ValidationError | null;

function softRule(
  check: (c: Record<string, unknown>) => boolean,
  field: string,
  message: string
): SoftRule {
  return (content) => (check(content) ? { field, message, severity: "soft" } : null);
}

const PRD_SOFT_RULES: SoftRule[] = [
  softRule(
    (c) => typeof c.problemStatement === "string" && c.problemStatement.length < 200,
    "problemStatement",
    "Problem statement is brief (<200 chars). Consider adding quantitative evidence and affected user count."
  ),
  softRule(
    (c) => {
      const tu = c.targetUser as Record<string, unknown> | undefined;
      return Array.isArray(tu?.painPoints) && tu.painPoints.length === 1;
    },
    "targetUser.painPoints",
    "Only one pain point listed. Additional pain points help cover edge-case user segments."
  ),
  softRule(
    (c) => {
      const tu = c.targetUser as Record<string, unknown> | undefined;
      return typeof tu?.jobToBeDone === "string" && tu.jobToBeDone.length < 40;
    },
    "targetUser.jobToBeDone",
    "Job-to-be-done is vague. Aim for a complete sentence describing the underlying goal."
  ),
  softRule(
    (c) => Array.isArray(c.successMetrics) && c.successMetrics.length === 1,
    "successMetrics",
    "A single success metric risks missing important dimensions (e.g., retention vs. adoption)."
  ),
  softRule(
    (c) => Array.isArray(c.outOfScope) && c.outOfScope.length === 2,
    "outOfScope",
    "Only the minimum 2 out-of-scope items. Consider listing more to preempt scope creep."
  ),
  softRule(
    (c) => Array.isArray(c.hypotheses) && c.hypotheses.length === 1,
    "hypotheses",
    "Single hypothesis. Most PRDs have 2–4 untested assumptions — explore further."
  ),
  softRule(
    (c) => Array.isArray(c.dependencies) && c.dependencies.length === 0,
    "dependencies",
    "No dependencies listed. Confirm this work is truly independent before marking complete."
  ),
  softRule(
    (c) => {
      const hyps = c.hypotheses as Array<Record<string, unknown>> | undefined;
      return (
        Array.isArray(hyps) &&
        hyps.some((h) => h.riskLevel === "high") &&
        typeof c.problemStatement === "string" &&
        c.problemStatement.length < 300
      );
    },
    "hypotheses",
    "High-risk hypothesis present. Consider expanding the problem statement with validation evidence."
  ),
];

const OKR_SOFT_RULES: SoftRule[] = [
  softRule(
    (c) => typeof c.objective === "string" && c.objective.length < 30,
    "objective",
    "Objective is very short. A good objective is inspirational and gives context to the team."
  ),
  softRule(
    (c) => {
      const krs = c.keyResults as Array<Record<string, unknown>> | undefined;
      return (
        Array.isArray(krs) &&
        krs.some(
          (kr) =>
            typeof kr.currentValue === "number" &&
            typeof kr.targetValue === "number" &&
            kr.currentValue === kr.targetValue
        )
      );
    },
    "keyResults",
    "One or more KRs have identical current and target values — this KR will always read 100%."
  ),
  softRule(
    (c) => {
      const krs = c.keyResults as Array<Record<string, unknown>> | undefined;
      const today = new Date().toISOString().slice(0, 10);
      return (
        Array.isArray(krs) &&
        krs.some(
          (kr) => typeof kr.dueDate === "string" && kr.dueDate < today
        )
      );
    },
    "keyResults",
    "One or more KRs have a due date in the past."
  ),
  softRule(
    (c) => typeof c.owner === "string" && c.owner.trim().length < 3,
    "owner",
    "Owner field is very short — use a full name or team identifier."
  ),
];

const BRIEF_SOFT_RULES: SoftRule[] = [
  softRule(
    (c) => Array.isArray(c.linkedOKRs) && c.linkedOKRs.length === 0,
    "linkedOKRs",
    "No linked OKRs. Consider connecting this brief to a strategic goal to justify prioritisation."
  ),
  softRule(
    (c) => typeof c.estimatedImpact === "string" && c.estimatedImpact.length < 40,
    "estimatedImpact",
    "Impact estimate is brief. Quantify if possible (e.g., 'could reduce churn by ~5%')."
  ),
  softRule(
    (c) =>
      c.confidence === "high" &&
      typeof c.opportunity === "string" &&
      c.opportunity.length < 60,
    "confidence",
    "High confidence claimed but the opportunity description is brief. Add supporting evidence."
  ),
  softRule(
    (c) =>
      typeof c.proposedSolution === "string" &&
      c.proposedSolution.toLowerCase().startsWith("we should"),
    "proposedSolution",
    "Solution reads as a directive. Frame it as a hypothesis: 'By doing X, we believe Y will happen.'"
  ),
];

const SOFT_RULES: Record<ArtifactTypeName, SoftRule[]> = {
  prd: PRD_SOFT_RULES,
  okr: OKR_SOFT_RULES,
  brief: BRIEF_SOFT_RULES,
};

// ── Zod error → hard ValidationError ─────────────────────────────────────────

function zodErrorsToHard(err: ZodError): ValidationError[] {
  return err.errors.map((issue) => ({
    field: issue.path.join(".") || "(root)",
    message: issue.message,
    severity: "hard" as const,
  }));
}

// ── Main validator ────────────────────────────────────────────────────────────

export function validateArtifact(
  artifactType: ArtifactTypeName,
  content: unknown
): ValidationResult {
  const schema = SCHEMAS[artifactType];

  // Inject the artifactType discriminant if missing so the discriminated union
  // in artifact.schema.ts resolves, but the individual schemas work standalone too.
  const input =
    typeof content === "object" && content !== null
      ? { artifactType, ...( content as object) }
      : content;

  const parseResult = schema.safeParse(input);

  const hardErrors: ValidationError[] = parseResult.success
    ? []
    : zodErrorsToHard(parseResult.error);

  // Run soft rules against the raw input regardless of hard-error state
  const rawContent =
    typeof content === "object" && content !== null
      ? (content as Record<string, unknown>)
      : {};

  const softErrors: ValidationError[] = SOFT_RULES[artifactType]
    .map((rule) => rule(rawContent))
    .filter((e): e is ValidationError => e !== null);

  const fieldCoverage = flattenCoverage(rawContent);
  const completenessScore = computeCompletenessScore(fieldCoverage, softErrors);

  return {
    valid: parseResult.success,
    errors: [...hardErrors, ...softErrors],
    completenessScore,
    fieldCoverage,
  };
}
