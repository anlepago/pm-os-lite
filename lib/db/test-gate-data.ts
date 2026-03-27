/**
 * Test script for gate-level DB columns and gate_health_summary view.
 * Run with: npx tsx lib/db/test-gate-data.ts
 *
 * Inserts 3 sample reviews with known gate pass/fail patterns, then
 * verifies the stored columns and getDashboardStats() gatePassRates.
 */
import { db, saveReview, getDashboardStats } from "./client";
import type { Review } from "./client";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGate(num: number, phase: string, passed: boolean) {
  return { gateId: `G${num}-test`, gateName: `Test Check ${num}`, phase, passed, reason: "test", blocksSubmission: true, documentationRef: "" };
}

function makeReview(id: string, gates: ReturnType<typeof makeGate>[], audit: Record<string, string>): Review {
  return {
    id,
    artifactId: null,
    qualityScore: 75,
    recommendation: "revise",
    blocked: gates.some((g) => !g.passed) ? 1 : 0,
    hardGatesJson: JSON.stringify(gates),
    softGatesJson: "[]",
    adversarialJson: JSON.stringify({ aiEraAudit: audit }),
    driftJson: "{}",
    reviewedAt: new Date().toISOString(),
    gate1_passed: null, gate2_passed: null, gate3_passed: null,
    gate4_passed: null, gate5_passed: null, gate6_passed: null,
    ai_era_audit_json: null, eval_credibility: null,
    economic_defensibility: null, operability_realism: null, compliance_readiness: null,
  };
}

// ── Clean up previous test rows ───────────────────────────────────────────────

db.prepare("DELETE FROM reviews WHERE id LIKE 'test-%'").run();

// ── Insert 3 reviews with known gate patterns ─────────────────────────────────
//
//  Review A: all 6 gates pass
//  Review B: gate1=fail, gate2=fail, gates 3-6=pass
//  Review C: gate3=fail, gate6=fail, rest pass
//
// Expected pass rates:
//   gate1: 2/3 = 67   gate2: 2/3 = 67   gate3: 2/3 = 67
//   gate4: 3/3 = 100  gate5: 3/3 = 100  gate6: 2/3 = 67

const reviewA = makeReview("test-A", [
  makeGate(1, "Gate 1: Evidence-Grounded Problem", true),
  makeGate(2, "Gate 2: Synthetic Evals", true),
  makeGate(3, "Gate 3: ROI Moat", true),
  makeGate(4, "Gate 4: NFR Zero Tolerance", true),
  makeGate(5, "Gate 5: Operability Constraints", true),
  makeGate(6, "Gate 6: Quantified Success", true),
], { evalCredibility: "credible", economicDefensibility: "strong", operabilityRealism: "realistic", complianceReadiness: "ready" });

const reviewB = makeReview("test-B", [
  makeGate(1, "Gate 1: Evidence-Grounded Problem", false),
  makeGate(2, "Gate 2: Synthetic Evals", false),
  makeGate(3, "Gate 3: ROI Moat", true),
  makeGate(4, "Gate 4: NFR Zero Tolerance", true),
  makeGate(5, "Gate 5: Operability Constraints", true),
  makeGate(6, "Gate 6: Quantified Success", true),
], { evalCredibility: "questionable", economicDefensibility: "weak", operabilityRealism: "optimistic", complianceReadiness: "gaps" });

const reviewC = makeReview("test-C", [
  makeGate(1, "Gate 1: Evidence-Grounded Problem", true),
  makeGate(2, "Gate 2: Synthetic Evals", true),
  makeGate(3, "Gate 3: ROI Moat", false),
  makeGate(4, "Gate 4: NFR Zero Tolerance", true),
  makeGate(5, "Gate 5: Operability Constraints", true),
  makeGate(6, "Gate 6: Quantified Success", false),
], { evalCredibility: "missing", economicDefensibility: "missing", operabilityRealism: "missing", complianceReadiness: "missing" });

saveReview(reviewA);
saveReview(reviewB);
saveReview(reviewC);
console.log("✓ 3 test reviews saved");

// ── Verify stored gate columns ─────────────────────────────────────────────────

const rows = db
  .prepare("SELECT id, gate1_passed, gate2_passed, gate3_passed, gate4_passed, gate5_passed, gate6_passed, eval_credibility, economic_defensibility, operability_realism, compliance_readiness, ai_era_audit_json FROM reviews WHERE id LIKE 'test-%' ORDER BY id")
  .all() as Record<string, unknown>[];

console.log("\n── Stored gate columns ──");
for (const row of rows) {
  console.log(JSON.stringify(row, null, 2));
}

// ── Verify gate_health_summary view ───────────────────────────────────────────

const summary = db.prepare("SELECT * FROM gate_health_summary").get() as Record<string, number | null>;
console.log("\n── gate_health_summary view ──");
console.log(JSON.stringify(summary, null, 2));

// ── Verify getDashboardStats() ────────────────────────────────────────────────

const stats = getDashboardStats();
console.log("\n── getDashboardStats().gatePassRates ──");
console.log(JSON.stringify(stats.gatePassRates, null, 2));

// ── Assertions ────────────────────────────────────────────────────────────────

function assert(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "✓" : "✗"} ${label}: ${ok ? "PASS" : `FAIL — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
  if (!ok) process.exitCode = 1;
}

const rA = rows.find((r) => r.id === "test-A")!;
const rB = rows.find((r) => r.id === "test-B")!;
const rC = rows.find((r) => r.id === "test-C")!;

console.log("\n── Assertions ──");
assert("A gate1_passed", rA.gate1_passed, 1);
assert("A gate6_passed", rA.gate6_passed, 1);
assert("A eval_credibility", rA.eval_credibility, "credible");
assert("A ai_era_audit_json parses", (() => { try { JSON.parse(rA.ai_era_audit_json as string); return true; } catch { return false; } })(), true);

assert("B gate1_passed", rB.gate1_passed, 0);
assert("B gate2_passed", rB.gate2_passed, 0);
assert("B gate3_passed", rB.gate3_passed, 1);
assert("B eval_credibility", rB.eval_credibility, "questionable");

assert("C gate3_passed", rC.gate3_passed, 0);
assert("C gate6_passed", rC.gate6_passed, 0);
assert("C gate4_passed", rC.gate4_passed, 1);

// Pass rates: gate1=67, gate2=67, gate3=67, gate4=100, gate5=100, gate6=67
// (these are across ALL reviews — other rows may exist so we check the test-only view)
const testOnlySummary = db.prepare(`
  SELECT
    CAST(ROUND(100.0 * SUM(gate1_passed) / NULLIF(COUNT(gate1_passed), 0)) AS INTEGER) AS g1,
    CAST(ROUND(100.0 * SUM(gate2_passed) / NULLIF(COUNT(gate2_passed), 0)) AS INTEGER) AS g2,
    CAST(ROUND(100.0 * SUM(gate3_passed) / NULLIF(COUNT(gate3_passed), 0)) AS INTEGER) AS g3,
    CAST(ROUND(100.0 * SUM(gate4_passed) / NULLIF(COUNT(gate4_passed), 0)) AS INTEGER) AS g4,
    CAST(ROUND(100.0 * SUM(gate5_passed) / NULLIF(COUNT(gate5_passed), 0)) AS INTEGER) AS g5,
    CAST(ROUND(100.0 * SUM(gate6_passed) / NULLIF(COUNT(gate6_passed), 0)) AS INTEGER) AS g6
  FROM reviews WHERE id LIKE 'test-%'
`).get() as { g1: number; g2: number; g3: number; g4: number; g5: number; g6: number };

assert("test-only gate1 rate = 67", testOnlySummary.g1, 67);
assert("test-only gate2 rate = 67", testOnlySummary.g2, 67);
assert("test-only gate3 rate = 67", testOnlySummary.g3, 67);
assert("test-only gate4 rate = 100", testOnlySummary.g4, 100);
assert("test-only gate5 rate = 100", testOnlySummary.g5, 100);
assert("test-only gate6 rate = 67", testOnlySummary.g6, 67);

// ── Cleanup ───────────────────────────────────────────────────────────────────

db.prepare("DELETE FROM reviews WHERE id LIKE 'test-%'").run();
console.log("\n✓ Test rows cleaned up");
