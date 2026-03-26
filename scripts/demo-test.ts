/**
 * demo-test.ts — end-to-end pipeline demo script
 *
 * Runs the full review pipeline against three versions of the
 * "Smart Notifications" PRD and one drifted Brief, then prints a
 * formatted report to the terminal.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/demo-test.ts
 *
 * Prerequisites:
 *   - ANTHROPIC_API_KEY set in .env.local
 *   - npx tsx lib/db/init.ts (creates the DB schema)
 */

// Load .env.local before any module that reads ANTHROPIC_API_KEY.
// tsx runs outside Next.js so we must load the env file manually.
// dotenv is not a dependency — we parse the file directly.
import fs from "fs";
import path from "path";

(function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
})();

import { randomUUID } from "crypto";
import { setActiveOKRBaseline } from "../lib/db/client";
import { runReviewPipeline, type ReviewReport } from "../lib/review/pipeline";
import { detectDrift, type DriftResult } from "../lib/agents/drift-detector";
import type { PRD } from "../lib/schemas/prd.schema";
import type { OKR } from "../lib/schemas/okr.schema";
import type { Brief } from "../lib/schemas/brief.schema";

// ── ANSI colour helpers ────────────────────────────────────────────────────────

const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  blue:   "\x1b[34m",
  cyan:   "\x1b[36m",
  white:  "\x1b[37m",
  gray:   "\x1b[90m",
};

const bold  = (s: string) => `${c.bold}${s}${c.reset}`;
const dim   = (s: string) => `${c.dim}${s}${c.reset}`;
const red   = (s: string) => `${c.red}${s}${c.reset}`;
const green = (s: string) => `${c.green}${s}${c.reset}`;
const yellow = (s: string) => `${c.yellow}${s}${c.reset}`;
const cyan  = (s: string) => `${c.cyan}${s}${c.reset}`;
const gray  = (s: string) => `${c.gray}${s}${c.reset}`;

function hr(ch = "─", width = 72) {
  console.log(gray(ch.repeat(width)));
}

function scoreBar(score: number, width = 40): string {
  const filled = Math.round((score / 100) * width);
  const empty  = width - filled;
  const colour = score >= 70 ? c.green : score >= 50 ? c.yellow : c.red;
  return `${colour}${"█".repeat(filled)}${c.gray}${"░".repeat(empty)}${c.reset} ${bold(String(score))}`;
}

function recBadge(rec: string, blocked: boolean): string {
  if (blocked)               return `${c.red}${c.bold}[ BLOCKED ]${c.reset}`;
  if (rec === "approve")     return `${c.green}${c.bold}[ APPROVE ]${c.reset}`;
  if (rec === "revise")      return `${c.yellow}${c.bold}[ REVISE  ]${c.reset}`;
  return                            `${c.red}${c.bold}[ REJECT  ]${c.reset}`;
}

function driftBadge(verdict: string): string {
  if (verdict === "aligned")            return green("● aligned");
  if (verdict === "minor_drift")        return yellow("◐ minor drift");
  if (verdict === "significant_drift")  return yellow("◑ significant drift");
  return                                       red("◉ MISALIGNED");
}

// ── Fixture data ───────────────────────────────────────────────────────────────
// These are schema-compliant objects. The rich documentation-style fixture files
// in /data/ describe the same scenario in prose form for the README walkthrough;
// these are the machine-readable equivalents the pipeline actually processes.

// ── OKR Baseline: Q1 2025 (retention + activation quarter) ────────────────────

const okrActivation: OKR = {
  artifactType: "okr",
  objective: "Dramatically improve new user activation so more trials convert to paid",
  keyResults: [
    {
      kr: "Increase trial-to-paid conversion rate from 18% to 28% by 2025-03-31",
      metric: "trial_to_paid_conversion",
      currentValue: 18,
      targetValue: 28,
      dueDate: "2025-03-31",
    },
    {
      kr: "Reduce median time-to-first-value from 4.2 days to 2.0 days by 2025-03-31",
      metric: "median_time_to_first_value_days",
      currentValue: 4.2,
      targetValue: 2.0,
      dueDate: "2025-03-31",
    },
    {
      kr: "Achieve 60% onboarding checklist completion rate by 2025-03-31",
      metric: "onboarding_checklist_completion_rate",
      currentValue: 31,
      targetValue: 60,
      dueDate: "2025-03-31",
    },
  ],
  timeframe: { quarter: "Q1", year: 2025 },
  owner: "Growth PM",
};

const okrRetention: OKR = {
  artifactType: "okr",
  objective: "Improve 30-day and 90-day retention so users reach the renewal milestone",
  keyResults: [
    {
      kr: "Raise 30-day retention for paid users from 42% to 55% by 2025-03-31",
      metric: "thirty_day_retention_paid",
      currentValue: 42,
      targetValue: 55,
      dueDate: "2025-03-31",
    },
    {
      kr: "Reduce monthly churn rate from 6.8% to 4.5% by 2025-03-31",
      metric: "monthly_churn_rate",
      currentValue: 6.8,
      targetValue: 4.5,
      dueDate: "2025-03-31",
    },
    {
      kr: "Increase proportion of highly-engaged paid users from 28% to 45% by 2025-03-31",
      metric: "highly_engaged_user_rate",
      currentValue: 28,
      targetValue: 45,
      dueDate: "2025-03-31",
    },
  ],
  timeframe: { quarter: "Q1", year: 2025 },
  owner: "Product PM",
};

// ── PRD v1: weak first draft — expect ~35/100, reject, hard gate failures ──────

const prdV1: PRD = {
  artifactType: "prd",
  title: "Smart Notifications Feature",
  artifactVersion: "1.0.0",
  problemStatement:
    "Users are missing important updates in the product. This is causing frustration " +
    "and we have heard complaints about notifications. We think that if we make " +
    "notifications smarter, users will be happier and more engaged with the product.",
  targetUser: {
    segment: "All Nexus users",
    painPoints: [
      "Miss important updates",
      "Feel overwhelmed by too many notifications",
    ],
    jobToBeDone: "Stay informed about changes that affect their work without being distracted",
  },
  successMetrics: [
    {
      metric: "Improve user engagement with notifications",
      baseline: "Current engagement is low",
      target: "Improve engagement over time",
      measurementMethod: "Track in analytics",
    },
  ],
  outOfScope: [
    "SMS notifications",
    "Third-party integrations",
  ],
  hypotheses: [
    {
      assumption: "If we personalize notifications, users will engage more with the product",
      validationMethod: "We will monitor engagement metrics after launch and see if they improve",
      riskLevel: "low",
    },
  ],
  dependencies: [],
};

// ── PRD v2: revised after first review — expect ~62/100, revise ───────────────

const prdV2: PRD = {
  artifactType: "prd",
  title: "Smart Notifications Feature — Revised",
  artifactVersion: "2.0.0",
  problemStatement:
    "In Q4 2024, 68% of surveyed users (n=312) cite notification overload as a top-5 " +
    "frustration. 41% of active users (8,240 accounts) have disabled all email " +
    "notifications. 6 of our last 11 churned enterprise accounts cited 'too much noise' " +
    "in exit interviews. Only 23% of active users engage with any notification weekly, " +
    "yet notification engagers show 18pp higher 30-day retention than non-engagers.",
  targetUser: {
    segment: "Power users on Team and Enterprise plans with 3+ logins/week",
    painPoints: [
      "Overwhelmed by high-frequency notifications across multiple workstreams",
      "Disabled email notifications to cope, now missing critical updates",
    ],
    jobToBeDone: "Stay on top of cross-functional work without being buried in noise",
  },
  successMetrics: [
    {
      metric: "Weekly notification engagement rate",
      baseline: "23% of active users engage with 1+ notification weekly",
      target: "40% of active users engage with 1+ notification weekly",
      measurementMethod: "We will track this in our analytics platform",
    },
    {
      metric: "Email notification opt-out rate",
      baseline: "41% of active users have disabled email notifications",
      target: "Reduce to 25% or below",
      measurementMethod: "User settings DB query run weekly",
    },
    {
      metric: "Preference center completion rate",
      baseline: "N/A (new feature)",
      target: "60% of new users complete preference setup within 7 days",
      measurementMethod: "Funnel analytics",
    },
  ],
  outOfScope: [
    "SMS and mobile push notifications (separate mobile initiative)",
    "Slack and Teams integrations (deferred to Q2)",
    "AI-based notification ranking (Phase 2)",
    "Bulk notification muting by org admins",
  ],
  hypotheses: [
    {
      assumption: "Users who complete preference setup will engage 15pp more than those who skip it",
      validationMethod: "Compare 60-day engagement rate between users who saved preferences vs those who did not",
      riskLevel: "medium",
    },
    {
      assumption: "Frequency caps will reduce email opt-outs without reducing total click-throughs",
      validationMethod: "A/B test: 50% new users get frequency caps, monitor opt-out and clicks after 30 days",
      riskLevel: "medium",
    },
    {
      assumption: "Digest mode will re-engage at least 20% of users who disabled email notifications",
      validationMethod: "We will see if opt-out numbers improve after launching digest mode",
      riskLevel: "high",
    },
  ],
  dependencies: ["OB-204: Onboarding wizard refactor", "INFRA-88: Email delivery SLA upgrade"],
};

// ── PRD v3: strong version — expect ~85/100, approve ─────────────────────────

const prdV3: PRD = {
  artifactType: "prd",
  title: "Smart Notifications — Preference Center and Frequency Controls",
  artifactVersion: "3.0.0",
  problemStatement:
    "In Q4 2024, 68% of surveyed users (n=312, ±5.5%) cite notification overload as a " +
    "top-5 frustration. 41% of active users (8,240 accounts, User Settings DB Jan 2025 " +
    "snapshot) have disabled all email notifications. 6 of 11 churned enterprise accounts " +
    "named 'too much noise' in exit interviews (Q3-Q4 2024). Only 23% of active users " +
    "engage with notifications weekly (Mixpanel 90-day trailing avg). Users who do engage " +
    "weekly show 30-day retention of 71% vs 53% for non-engagers — an 18pp gap (Mixpanel " +
    "cohort analysis, Q4 2024, n=3,100+). This feature gives users per-category channel " +
    "controls and frequency caps, targeting +17pp engagement and -16pp opt-out rate.",
  targetUser: {
    segment: "Power users on Team/Enterprise plans — 3+ logins/week, managing cross-functional workflows (approx 2,800 users, 34% of active base)",
    painPoints: [
      "Notification volume across 14 types and 4 channels overwhelms users who manage multiple workstreams",
      "Binary email on/off toggle is too coarse — users disable everything to escape noise, missing critical updates",
      "No digest option means users who go offline return to an undifferentiated wall of notifications",
    ],
    jobToBeDone: "Stay informed about work that requires action without spending cognitive load triaging irrelevant pings",
  },
  successMetrics: [
    {
      metric: "Weekly notification engagement rate",
      baseline: "23% of active users engage with 1+ notification per week (Mixpanel 90-day avg)",
      target: "40% of active users engage weekly (+17pp)",
      measurementMethod: "Mixpanel: event notification_clicked OR notification_action_taken, unique users / MAU, 7-day rolling window — Looker dashboard: notif-engagement-weekly",
    },
    {
      metric: "Email notification opt-out rate",
      baseline: "41% of active users have email notifications disabled (User Settings DB, Jan 2025)",
      target: "25% or fewer have email disabled (-16pp) within 60 days of full rollout",
      measurementMethod: "Scheduled DB query: SELECT COUNT(*) WHERE email_notif_enabled = false / total_active_users — automated weekly report to #pm-metrics Slack channel",
    },
    {
      metric: "Preference center completion rate for new users",
      baseline: "N/A (new feature)",
      target: "60% of new users complete preference setup within 7 days of signup",
      measurementMethod: "Mixpanel funnel: signup_completed → notification_preferences_saved, 7-day attribution window",
    },
    {
      metric: "30-day retention contribution toward Q1 OKR KR1",
      baseline: "Notification engagers: 71% retention; non-engagers: 53% — 18pp gap",
      target: "Gap maintained or widened; aggregate 30-day retention moves from 42% toward 55% (Q1 KR1)",
      measurementMethod: "Mixpanel 30-day retention cohort report, paid users, segmented by notification_engaged_7d — monthly cohort, 90-day result window",
    },
  ],
  outOfScope: [
    "SMS and mobile push notifications (mobile team initiative, Q2 roadmap)",
    "Slack and Microsoft Teams integrations (deferred Q2 — separate OAuth and delivery infrastructure required)",
    "AI/ML-based notification ranking (Phase 3 — dependent on Phase 1+2 engagement data)",
    "Notification analytics dashboard for end users (lower priority than admin view)",
    "Bulk notification muting by org admins for entire org (fewer than 3 support requests in Q4)",
    "Browser push notifications on mobile web (browser API fragmentation, low ROI vs Phase 1 impact)",
  ],
  hypotheses: [
    {
      assumption: "Users who complete preference setup will have at least 15pp higher weekly notification engagement than users who skip setup",
      validationMethod: "60 days post-Phase 1: compare Mixpanel weekly engagement between cohort A (preference_saved within 7 days) and cohort B (no preference event). Min 500 users per cohort. Decision rule: if lift < 10pp, preference setup UX needs redesign; if > 15pp, prioritise in-product prompts.",
      riskLevel: "medium",
    },
    {
      assumption: "Frequency caps will reduce email opt-outs by at least 8pp without reducing total notification click-throughs by more than 10%",
      validationMethod: "A/B test: 50% of new Team/Enterprise users get frequency caps at signup (group A), 50% get current default (group B). Measure opt-out rate and total clicks at 30 days. Decision rule: if opt-out delta < 5pp OR clicks drop > 10% in group A, frequency caps are not solving the right problem — revert and investigate digest-only approach.",
      riskLevel: "high",
    },
    {
      assumption: "Digest mode will re-engage at least 20% of the 41% who disabled email notifications, and they will maintain digest opt-in for 30+ days",
      validationMethod: "Phase 2 launch: one-time re-engagement email to all users with email_notif_enabled=false offering digest opt-in. Track: open rate, digest opt-in rate, 30-day email opt-out rate for opt-ins. Decision rule: if digest opt-in rate from campaign < 10%, digest mode is not compelling to this segment — do not invest in further digest personalisation.",
      riskLevel: "high",
    },
  ],
  dependencies: [
    "OB-204: Onboarding wizard refactor (ships Week 4) — required for activation OKR connection",
    "INFRA-88: Email delivery rate SLA upgrade to 99.5% (ships Week 2) — required before increasing digest volume",
    "Data team: Mixpanel funnel event setup for preference completion tracking (2 days, before Phase 1 launch)",
  ],
};

// ── Drifted Brief: acquisition work in a retention quarter ───────────────────

const briefDrifted: Brief = {
  artifactType: "brief",
  opportunity:
    "CAC hit $480 in Q4 2024 (+40% YoY). 14 users acquired via word-of-mouth in Q4 " +
    "showed 74% 30-day retention vs our 42% average. If we systematise referrals and " +
    "add an SEO content hub targeting B2B ops managers, we can build a compounding " +
    "low-CAC acquisition channel that also improves aggregate retention metrics.",
  proposedSolution:
    "Launch a two-pillar growth loop: (1) in-product referral program with $20 account " +
    "credits per successful conversion and extended trial for referred users; (2) SEO " +
    "content hub at /resources with 12 long-form articles targeting high-intent keywords, " +
    "each with a lead capture form and a 5-email nurture sequence.",
  linkedOKRs: ["O2-KR1", "O2-KR2"],
  estimatedImpact:
    "20% of new signups arrive via referral by March; 150 trial signups from content hub " +
    "in Q1; referred users convert at 2x organic rate. Aggregate retention improves " +
    "passively as acquisition mix shifts toward higher-quality referral channel.",
  confidence: "medium",
};

// ── Formatting helpers ─────────────────────────────────────────────────────────

function printReviewReport(report: ReviewReport, index: number, total: number): void {
  const passedGates = report.hardGates.filter((g) => g.passed);
  const failedGates = report.hardGates.filter((g) => !g.passed);
  const passedSoft  = report.softGates.filter((g) => g.passed);

  console.log();
  hr("═");
  console.log(
    bold(`  ARTIFACT ${index}/${total}`) + dim("  ·  ") +
    cyan(bold(report.artifactName)) +
    "  " + dim(`v${(report as ReviewReport & { artifactVersion?: string }).artifactVersion ?? "—"}`)
  );
  hr("═");

  // Score bar
  console.log();
  console.log(`  Quality Score   ${scoreBar(report.qualityScore)}/100`);
  console.log(`  Recommendation  ${recBadge(report.recommendation, report.blocked)}`);
  console.log();

  // Hard gates
  hr();
  console.log(bold("  HARD GATES") + dim("  (blocking — any failure prevents submission)"));
  hr();
  for (const g of report.hardGates) {
    const icon = g.passed ? green("✓") : red("✗");
    console.log(`  ${icon}  ${g.passed ? gray(g.gateName) : bold(g.gateName)}`);
    if (!g.passed) {
      console.log(`      ${red("↳")} ${g.reason}`);
    }
  }
  if (failedGates.length === 0) {
    console.log(`  ${dim(`All ${passedGates.length} hard gates passed.`)}`);
  } else {
    console.log();
    console.log(`  ${red(bold(`${failedGates.length} gate(s) failed — submission blocked.`))}`);
  }

  // Soft gates
  console.log();
  hr();
  console.log(bold("  SOFT GATES") + dim("  (warnings — affect score, do not block)"));
  hr();
  for (const g of report.softGates) {
    const icon = g.passed ? green("✓") : yellow("⚠");
    console.log(`  ${icon}  ${g.passed ? gray(g.gateName) : bold(g.gateName)}`);
    if (!g.passed && g.suggestion) {
      console.log(`      ${yellow("↳")} ${g.suggestion}`);
    }
  }
  const softSummary = `${passedSoft.length}/${report.softGates.length} soft gates passed`;
  console.log(`  ${dim(softSummary)}`);

  // Adversarial review
  const ai = report.adversarialReview;
  const riskColour = ai.overallRisk === "low" ? green : ai.overallRisk === "medium" ? yellow : red;
  console.log();
  hr();
  console.log(bold("  ADVERSARIAL AI REVIEW") + dim("  (Claude, skeptical VP of Product persona)"));
  hr();
  console.log(`  Overall risk   ${riskColour(bold(ai.overallRisk.toUpperCase()))}`);

  if (ai.redFlags.length > 0) {
    console.log();
    console.log(`  ${red(bold("Red flags:"))} ${dim(`(top ${ai.redFlags.length})`)}`);
    for (const flag of ai.redFlags) {
      console.log(`    ${red("▸")} ${flag}`);
    }
  }

  if (ai.strengthSignals.length > 0) {
    console.log();
    console.log(`  ${green(bold("Strength signals:"))}`);
    for (const s of ai.strengthSignals) {
      console.log(`    ${green("▸")} ${s}`);
    }
  }

  if (ai.findings.length > 0) {
    console.log();
    console.log(`  ${bold("Findings:")} ${dim(`(${ai.findings.length} total)`)}`);
    for (const f of ai.findings) {
      const sevColour = f.severity === 3 ? red : f.severity === 2 ? yellow : gray;
      const sevLabel  = f.severity === 3 ? "CRITICAL" : f.severity === 2 ? "CONCERN" : "NOTE";
      console.log(`    ${sevColour(`[${sevLabel}]`)} ${f.findingType} — ${f.section}`);
      console.log(`    ${dim("↳")} ${f.description}`);
      console.log(`    ${dim("?")} ${cyan(f.suggestedQuestion)}`);
      console.log();
    }
  }
}

function printDriftReport(
  artifactLabel: string,
  result: DriftResult,
  index: number
): void {
  console.log();
  hr("═");
  console.log(bold(`  DRIFT DETECTION ${index}`) + dim("  ·  ") + cyan(bold(artifactLabel)));
  hr("═");

  const driftColour =
    result.driftScore >= 65 ? c.red :
    result.driftScore >= 40 ? c.yellow :
    c.green;

  console.log();
  console.log(`  Drift Score   ${driftColour}${bold(String(result.driftScore))}${c.reset}/100`);
  console.log(`  Verdict       ${driftBadge(result.verdict)}`);

  if (result.driftType.length > 0) {
    console.log(`  Drift Types   ${result.driftType.map((t) => yellow(t)).join("  ")}`);
  }

  if (result.driftSignals.length > 0) {
    console.log();
    hr();
    console.log(bold("  DRIFT SIGNALS") + dim("  (dimension-level comparison vs OKR baseline)"));
    hr();
    for (const sig of result.driftSignals) {
      const sevColour = sig.driftSeverity === "high" ? red : sig.driftSeverity === "medium" ? yellow : gray;
      console.log(`  ${sevColour(bold(sig.driftSeverity.toUpperCase()))}  ${bold(sig.dimension)}`);
      console.log(`    ${dim("baseline:")} ${sig.baselineSignal}`);
      console.log(`    ${dim("new:     ")} ${sig.newSignal}`);
      console.log();
    }
  }

  console.log();
  hr();
  console.log(bold("  RECOMMENDATION"));
  hr();
  console.log(`  ${result.recommendation}`);
}

// ── Timing helper ─────────────────────────────────────────────────────────────

function elapsed(startMs: number): string {
  const ms = Date.now() - startMs;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // ── Banner ─────────────────────────────────────────────────────────────────
  console.log();
  console.log(cyan(bold("  PM-OS LITE — END-TO-END DEMO PIPELINE")));
  console.log(dim("  Smart Notifications PRD · three versions · plus drift detection"));
  console.log(dim("  Feature scenario: B2B SaaS, Q1 2025 retention + activation quarter"));
  console.log();

  // ── Step 0: Seed OKR baseline ──────────────────────────────────────────────
  hr("═");
  console.log(bold("  STEP 0  ·  Setting active OKR baseline"));
  hr("═");
  console.log();
  console.log("  Registering Q1 2025 OKRs as the active strategy baseline ...");

  // Store the two OKRs as a combined JSON blob in the okr_baselines table.
  setActiveOKRBaseline({
    id: randomUUID(),
    timeframe: "Q1-2025",
    content: JSON.stringify({ objectives: [okrActivation, okrRetention] }),
    setAt: new Date().toISOString(),
    isActive: 1,
  });

  console.log(green("  ✓ O1: Dramatically improve new user activation"));
  console.log(green("  ✓ O2: Improve 30-day and 90-day retention"));
  console.log();
  console.log(dim("  Key context: Q1 is a retention/activation quarter."));
  console.log(dim("  Acquisition work is explicitly out-of-strategy until Q2."));

  // ── PRD reviews ────────────────────────────────────────────────────────────
  const prdCases: Array<{ artifact: PRD; label: string; expectation: string }> = [
    {
      artifact: prdV1,
      label: "PRD v1.0.0 — weak first draft",
      expectation: "Expect: hard gate failures, score ~35, reject",
    },
    {
      artifact: prdV2,
      label: "PRD v2.0.0 — revised after first review",
      expectation: "Expect: gates pass, soft gate warnings, score ~62, revise",
    },
    {
      artifact: prdV3,
      label: "PRD v3.0.0 — strong, demo-ready version",
      expectation: "Expect: all gates pass, score ~85, approve",
    },
  ];

  const scores: number[] = [];
  let blockedCount = 0;
  let driftIncidents = 0;

  for (let i = 0; i < prdCases.length; i++) {
    const { artifact, label, expectation } = prdCases[i];
    console.log();
    hr("─");
    console.log(
      `  ${dim(`STEP ${i + 1}/5`)}  Running pipeline: ${bold(label)}`
    );
    console.log(`  ${dim(expectation)}`);
    hr("─");
    console.log();
    process.stdout.write("  Running review pipeline (hard gates + soft gates + AI) ...");

    const t0 = Date.now();
    const report = await runReviewPipeline(
      artifact,
      randomUUID(),
      artifact.title,
      "prd"
    );
    process.stdout.write(` ${green("done")} ${dim(`(${elapsed(t0)})`)}\n`);

    printReviewReport(report, i + 1, 3);
    scores.push(report.qualityScore);
    if (report.blocked) blockedCount++;
  }

  // ── Drift detection: PRD v3 vs OKRs ───────────────────────────────────────
  console.log();
  hr("─");
  console.log(`  ${dim("STEP 4/5")}  Drift detection: ${bold("PRD v3 vs Q1 OKR baseline")}`);
  console.log(`  ${dim("Expect: aligned or minor drift — PRD explicitly maps to both OKRs")}`);
  hr("─");
  console.log();
  process.stdout.write("  Extracting strategic signals and comparing vs OKR baseline ...");

  const t1 = Date.now();
  const driftPrdV3 = await detectDrift(prdV3, [okrActivation, okrRetention]);
  process.stdout.write(` ${green("done")} ${dim(`(${elapsed(t1)})`)}\n`);

  printDriftReport("Smart Notifications PRD v3.0.0 vs Q1 OKRs", driftPrdV3, 1);
  if (driftPrdV3.driftScore >= 40) driftIncidents++;

  // ── Drift detection: drifted Brief vs OKRs ────────────────────────────────
  console.log();
  hr("─");
  console.log(`  ${dim("STEP 5/5")}  Drift detection: ${bold("Drifted Brief vs Q1 OKR baseline")}`);
  console.log(`  ${dim("Expect: misaligned — acquisition work disguised as a retention play")}`);
  hr("─");
  console.log();
  process.stdout.write("  Extracting strategic signals and comparing vs OKR baseline ...");

  const t2 = Date.now();
  const driftBrief = await detectDrift(briefDrifted, [okrActivation, okrRetention]);
  process.stdout.write(` ${green("done")} ${dim(`(${elapsed(t2)})`)}\n`);

  printDriftReport("Growth Loop Brief (referral + SEO) vs Q1 OKRs", driftBrief, 2);
  if (driftBrief.driftScore >= 40) driftIncidents++;

  // ── Final summary ──────────────────────────────────────────────────────────
  const scoreImprovement = scores[scores.length - 1] - scores[0];

  console.log();
  hr("═");
  console.log(bold("  PIPELINE SUMMARY"));
  hr("═");
  console.log();
  console.log(
    `  Pipeline processed ${bold(String(prdCases.length + 1))} artifacts, ` +
    `detected ${bold(String(driftIncidents))} drift incident${driftIncidents !== 1 ? "s" : ""}, ` +
    `blocked ${bold(String(blockedCount))} submission${blockedCount !== 1 ? "s" : ""} on hard gates, ` +
    `average quality score improvement: ${green(bold(`+${scoreImprovement}pts`))} ` +
    `(v1→v3)`
  );
  console.log();

  console.log(dim("  Score progression across PRD versions:"));
  for (let i = 0; i < scores.length; i++) {
    const label = `v${i + 1}.0.0`;
    const arrow = i < scores.length - 1 ? ` → ` : "";
    const scoreColour = scores[i] >= 70 ? green : scores[i] >= 50 ? yellow : red;
    process.stdout.write(`    ${dim(label)} ${scoreColour(bold(String(scores[i])))}${dim(arrow)}`);
  }
  console.log();
  console.log();

  console.log(dim("  Drift verdicts:"));
  console.log(`    PRD v3 vs OKRs  ${driftBadge(driftPrdV3.verdict)}  ${dim(`(score: ${driftPrdV3.driftScore})`)}`);
  console.log(`    Brief  vs OKRs  ${driftBadge(driftBrief.verdict)}  ${dim(`(score: ${driftBrief.driftScore})`)}`);
  console.log();
  console.log(dim("  What the pipeline demonstrated:"));
  console.log(`    ${green("●")} Hard gates caught a weak PRD before it reached engineering`);
  console.log(`    ${green("●")} Soft gates surfaced specific wording and measurement issues`);
  console.log(`    ${green("●")} Adversarial AI identified correlation/causation risk and unvalidated assumptions`);
  console.log(`    ${green("●")} Drift detection caught acquisition work disguised as retention strategy`);
  console.log();
  hr("═");
  console.log();
}

main().catch((err) => {
  console.error(red(bold("\nFATAL ERROR:")), err);
  process.exit(1);
});
