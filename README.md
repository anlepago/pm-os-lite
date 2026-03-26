# pm-os-lite

```
 ██████╗ ███╗   ███╗       ██████╗ ███████╗
 ██╔══██╗████╗ ████║      ██╔═══██╗██╔════╝
 ██████╔╝██╔████╔██║█████╗██║   ██║███████╗
 ██╔═══╝ ██║╚██╔╝██║╚════╝██║   ██║╚════██║
 ██║     ██║ ╚═╝ ██║      ╚██████╔╝███████║
 ╚═╝     ╚═╝     ╚═╝       ╚═════╝ ╚══════╝
                                      lite
```

**An AI-powered review pipeline that enforces PM rigor: schema validation, adversarial critique, and strategic drift detection — before a single line of code is scoped.**

---

## What Problem This Solves

Most product artifacts fail silently. A PRD with no numeric baselines, unfalsifiable hypotheses, and vague success criteria will pass a human review because reviewers optimize for social harmony, not intellectual rigor. By the time the feature ships and the post-mortem asks "how did we measure success?", the PM who wrote the PRD has moved on and the metrics were never instrumented. This system applies a deterministic gate layer and an adversarial AI reviewer at write-time — when the cost of revision is a text edit, not a re-scoped quarter.

---

## System Architecture

```
                          ┌─────────────────────────────────────────┐
                          │              Browser / UI                │
                          │   Submit Form  ──►  Review Results Page  │
                          └──────────────┬──────────────────────────┘
                                         │ POST /api/review
                                         ▼
                          ┌─────────────────────────────────────────┐
                          │           Review Pipeline                │
                          │                                         │
                          │  ① Zod Schema Validation               │
                          │       ↓ (rejects malformed input)       │
                          │  ② Hard Gates  (5 blocking checks)      │
                          │       ↓ (any failure → reject + block)  │
                          │  ③ Soft Gates  (6 weighted checks)      │
                          │       ↓ (warnings, affect score)        │
                          │  ④ Adversarial AI Review               │
                          │       ↓ (Claude Sonnet, tool_use)       │
                          │                                         │
                          │  Score = hardScore × 0.2               │
                          │        + softScore × 0.4               │
                          │        + aiScore   × 0.4               │
                          └──────────────┬──────────────────────────┘
                                         │
                          ┌──────────────▼──────────────────────────┐
                          │           Drift Detection                │
                          │                                         │
                          │  POST /api/drift                        │
                          │                                         │
                          │  Step 1: Extract semantic signals       │
                          │    (cached by content hash)             │
                          │                                         │
                          │  Step 2: Compare against OKR baseline   │
                          │    or prior artifact versions           │
                          │    (cached by pairwise hash)            │
                          │                                         │
                          │  Output: driftScore (0–100) + verdict  │
                          └──────────────┬──────────────────────────┘
                                         │
                          ┌──────────────▼──────────────────────────┐
                          │           SQLite (better-sqlite3)        │
                          │                                         │
                          │  artifacts      okr_baselines           │
                          │  reviews        review_reports          │
                          │  validation_results                     │
                          │                                         │
                          │  WAL mode  ·  content-hash caching      │
                          └─────────────────────────────────────────┘
```

---

## Core Capabilities

### 1. Schema Enforcement via Zod Discriminated Unions

Three artifact types — `PRD | OKR | Brief` — each with a strict Zod schema. The PRD schema rejects submissions with:
- Titles under 10 characters (vague names indicate vague thinking)
- Problem statements under 100 characters (a sentence is not a problem statement)
- Success metrics missing a baseline, target, or measurement method
- Fewer than 2 out-of-scope items (1 item is a placeholder, not a decision)
- Hypotheses without a named validation method

Schema validation is synchronous and runs before any AI call. Malformed input never reaches the gate layer.

### 2. Hard Gates — Blocking Quality Checks

Five deterministic checks that immediately block an artifact:

| Gate | Condition | Fail Reason |
|------|-----------|-------------|
| `hasProblemStatement` | Problem ≥ 100 chars | Forces evidence and frequency, not a single sentence |
| `hasSuccessMetrics` | ≥ 2 metrics, each with target | No metric = no definition of done |
| `hasOutOfScope` | ≥ 2 items listed | 1 item is not a scoping decision |
| `hasValidationMethod` | Every hypothesis names a method | Unvalidatable hypotheses are assumptions |
| `noVagueMetrics` | No "improve/increase/better" without a number | Direction is not a target |

Any failure sets `blocked: true` and `recommendation: "reject"`. The artifact cannot proceed to engineering until all hard gates pass.

### 3. Soft Gates — Weighted Quality Scoring

Six weighted checks that do not block but reduce quality score and surface specific warnings:

| Gate | Weight | Triggers When |
|------|--------|---------------|
| `scopeCreep` | 0.28 | Out-of-scope items use "v2 / phase / future" hedging language |
| `metricsMeasurability` | 0.22 | Measurement method description is under 20 characters |
| `hypothesisRiskBalance` | 0.20 | All hypotheses are rated "low" risk |
| `userSegmentSpecificity` | 0.18 | Target user segment is generic ("users", "customers") |
| `dependencyRisk` | 0.12 | More than 5 external dependencies listed |
| `confidenceCalibration` | 0.28 | Brief has confidence=high but impact description < 60 chars |

Soft gate score feeds into the final quality score at 40% weight.

### 4. Adversarial AI Review

An AI reviewer persona modeled as a skeptical VP of Product. Uses Claude's `tool_use` API to guarantee structured JSON output — not a parsed prose response. Each review produces:

- `overallRisk`: `low | medium | high | critical`
- `findings[]`: Each finding has `section`, `findingType`, `description`, `suggestedQuestion`, `severity`
- `redFlags[]`: Maximum 3 top concerns — the things most likely to cause a post-mortem
- `strengthSignals[]`: What is genuinely well-defined

**Finding types**: `assumption`, `contradiction`, `vanity_metric`, `missing_evidence`, `scope_risk`

The AI score maps to: `{ low: 100, medium: 70, high: 35, critical: 0 }` and is blended into the final score at 40% weight.

All reviews are cached by SHA-256 content hash. Re-submitting an identical PRD does not make an API call.

### 5. Strategic Drift Detection

A two-step pipeline that detects when a feature brief or PRD is drifting away from the active OKR baseline:

**Step 1 — Signal Extraction**: For each artifact, Claude extracts 4 semantic signals:
- `coreUserProblem` — What user pain is this solving?
- `primaryBusinessOutcome` — What business result is expected?
- `keyAssumptions` — What must be true for this to work?
- `strategicBets` — What approach is being bet on?

**Step 2 — Drift Comparison**: Signal sets are compared against the active OKR baseline (or prior versions of the same artifact) to produce:
- `driftScore` (0–100)
- `verdict`: `aligned | minor_drift | significant_drift | misaligned`
- `driftedObjectives[]` — Which OKRs are no longer addressed
- Natural-language recommendation

Both steps are independently cached by content hash. The comparison step caches by a pairwise hash (order-independent) so comparing A to B and B to A shares a cache entry.

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | Next.js 14 (App Router) | API routes + React UI in a single deployable unit |
| AI | Anthropic Claude Sonnet | `tool_use` for structured output; extended thinking for drift analysis |
| Database | better-sqlite3 | Synchronous, embedded, zero-infrastructure — see Design Decisions |
| Validation | Zod 3 | Runtime validation + TypeScript type inference from a single schema definition |
| UI Components | Radix UI + shadcn/ui | Accessible primitives, no CSS framework lock-in |
| Charts | Recharts | Composable React chart library |
| Styling | Tailwind CSS | Utility-first, no build step for CSS |

---

## Quick Start

```bash
# 1. Clone
git clone <repo-url>
cd pm-os-lite

# 2. Install dependencies
npm install

# 3. Set your Anthropic API key
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local

# 4. Initialize the database schema
npx tsx lib/db/init.ts

# 5. Start the dev server
npm run dev
# → http://localhost:3000

# 6. Seed the database with demo data
curl -X POST http://localhost:3000/api/seed
# or click "Seed Demo Data" in the UI
```

The database is created at `data/pm-os.db` on first run. No external database, no Docker, no migrations to run.

---

## How It Works

A submitted artifact passes through four sequential stages:

**Stage 1 — Schema Validation** (`lib/schemas/`): The artifact is parsed against its Zod schema. Missing required fields and type violations are returned as structured errors with field-level paths. Nothing proceeds until the schema is valid.

**Stage 2 — Hard Gates** (`lib/gates/hard-gates.ts`): Five deterministic checks run synchronously against the validated artifact. Any failure sets `blocked: true`. The gate result includes a `reason` string explaining specifically what is missing and why it matters, not just that a check failed.

**Stage 3 — Soft Gates + Adversarial Review** (`lib/gates/soft-gates.ts`, `lib/agents/adversarial-reviewer.ts`): These run in parallel. Soft gates produce weighted quality scores and per-gate suggestions. The adversarial reviewer makes a Claude API call (or returns a cache hit) and produces `findings`, `redFlags`, and `strengthSignals`. The three scores (hard, soft, AI) are combined using the formula above.

**Stage 4 — Drift Detection** (`lib/agents/drift-detector.ts`): Run separately via `POST /api/drift`. Compares the artifact against the active OKR baseline stored in the `okr_baselines` table. The two-step extraction-then-comparison architecture means signal extraction is reusable across multiple baseline comparisons without re-running the first Claude call.

---

## Demo Walkthrough

The `data/` directory contains three versions of the same PRD — "Smart Notifications for a B2B SaaS platform" — and a set of OKRs. This is a complete scenario showing the system's reasoning at each quality level.

**Setup**: Run `curl -X POST http://localhost:3000/api/seed` to populate the dashboard with baseline data.

**Step 1 — Load the active OKR baseline**

Navigate to the Review page. The Q1 2025 OKRs (`data/sample-okrs.json`) are pre-loaded as the active baseline. Note the strategy context: this is a retention-and-activation quarter. Acquisition work is explicitly listed as out-of-strategy.

**Step 2 — Submit v1 (the weak first draft)**

Paste the contents of `data/sample-prd-v1.json` into the submission form, selecting type "PRD."

Expected result:
- Hard gates: 3 failures (`noVagueMetrics`, `hasValidationMethod`, `problem_quantified`)
- Score: ~35/100, Recommendation: Reject (blocked)
- Adversarial: High risk — the AI flags that "smart" appears 4 times with no definition, and that all success metrics are directional with no way to declare success or failure after shipping

**Step 3 — Submit v2 (revised after first review)**

Paste `data/sample-prd-v2.json`.

Expected result:
- Hard gates: All pass (problem is now quantified, metrics have numbers)
- Score: ~62/100, Recommendation: Revise
- Soft gate warnings: Measurement method for metric 1 is vague ("we'll track this in our analytics"), hypothesis 3 has no decision rule, OKR connection is asserted rather than mapped
- Adversarial: Medium risk — flags the retention correlation as observational, not causal

**Step 4 — Submit v3 (production-quality PRD)**

Paste `data/sample-prd-v3.json`.

Expected result:
- Hard gates: All pass
- Score: ~85/100, Recommendation: Approve
- Each metric references the specific Mixpanel event name and Looker dashboard; each hypothesis has an explicit decision rule ("if lift is <10pp, the UX needs redesign")
- OKR alignment section explicitly maps to both O1 and O2 with stated assumptions
- Adversarial: Low risk — minor concern about a back-of-envelope retention estimate

**Step 5 — Demonstrate drift detection**

Submit `data/sample-brief-drifted.json` and run drift detection against the active Q1 OKRs.

The brief proposes a referral program and SEO content hub — acquisition infrastructure. The author frames it as a "retention play," citing a 74% retention rate from 14 referred users.

Expected result:
- Drift score: ~78/100, Verdict: Misaligned
- The drift agent identifies that all deliverables (referral links, SEO articles, email nurture sequences) address zero of the three O2 key results
- The adversarial agent flags the n=14 sample as having an obvious selection effect
- OKR context note: Q1 OKRs explicitly list "no new acquisition channels" as out-of-strategy

This is the system catching strategic drift that a human reviewer would likely miss because the author's framing is plausible-sounding.

---

## Design Decisions

### Why SQLite (not Postgres, not Prisma)

SQLite with `better-sqlite3` was a deliberate choice, not a shortcut. The database is a single file at `data/pm-os.db`. There is no connection string to configure, no Docker container to start, no migration runner to coordinate. A reviewer can clone this repo, run two commands, and have a working system in under two minutes. The WAL (Write-Ahead Logging) journal mode provides concurrent reads without write blocking, which is sufficient for a single-server application at this scale. For a production system serving multiple application servers, the correct choice is Postgres — but portability and zero infrastructure are the right tradeoffs for a system whose primary purpose is demonstrating reasoning architecture, not handling production load.

### Why Zod Schemas (not JSON Schema, not ad-hoc validation)

Zod provides two things simultaneously from a single definition: runtime validation and TypeScript type inference. The PRD schema (`lib/schemas/prd.schema.ts`) is the authoritative definition of what a valid PRD looks like. That same schema powers the API input parsing, the gate checks, and every TypeScript type used downstream. If the schema gains a new required field, the compiler immediately surfaces every callsite that doesn't handle it. Maintaining a separate JSON Schema alongside a separate TypeScript interface creates two sources of truth that diverge over time; Zod prevents that by construction.

### Why Adversarial Review as a Separate Agent

The adversarial reviewer and the gate system answer different questions. Hard and soft gates ask: "does this PRD have the required components?" — a structural question with a deterministic answer. The adversarial reviewer asks: "if this PRD is correct, what could still go wrong?" — a question requiring reasoning over content semantics, not just structural presence. Combining them into one prompt would make both worse: gate logic would become probabilistic (subject to LLM variance on each run), and the AI review would waste tokens re-checking things the deterministic system already handles reliably. Separation of concerns produces more consistent gate results and higher-quality adversarial analysis.

### Why Drift Detection (strategy is a time dimension)

A PRD can pass every quality check and still be the wrong thing to build. Quality checks are stateless — they evaluate an artifact in isolation. Drift detection adds a temporal dimension: it compares what the artifact proposes against what the company committed to for the quarter. The two-step architecture (signal extraction, then comparison) reflects a specific insight: semantic understanding of an artifact is stable, but the comparison target changes. When new OKRs are set each quarter, previously extracted signals can be re-compared against the new baseline without re-running extraction. This also keeps the caching logic clean: extraction is cached by content hash (independent of what it's compared against), and comparison is cached by a pairwise hash that is order-independent.

---

## What This Is Not

This is a proof-of-concept for applying systems thinking to PM rigor — not a production PM tool.

It demonstrates: how to design a multi-stage validation pipeline, how to use AI as a structured analysis instrument rather than a generative assistant, how to think about caching strategy for LLM calls, and how to encode product quality standards into explicit deterministic rules before reaching for probabilistic AI judgment.

It is not: a replacement for human judgment, a document management system, a collaboration platform, or a tool designed for teams. There is no authentication, no multi-tenancy, no role-based access, and no real-time sync. The review pipeline is a demonstration of reasoning architecture, not a production workflow.

The gate weights, score formulas, and hypothesis validation requirements reflect one PM's theory of what constitutes a rigorous artifact. They are debatable. The point is that they are explicit and inspectable, rather than tacit and inconsistent.

---

## Project Structure

```
pm-os-lite/
├── app/
│   ├── api/
│   │   ├── review/              # Full pipeline: gates + adversarial (24h cache per artifact)
│   │   ├── drift/               # Drift detection: OKR mode or historical version comparison
│   │   ├── adversarial-review/  # Adversarial review in isolation
│   │   ├── validate/            # Schema validation + completeness score
│   │   ├── dashboard/           # Aggregate stats
│   │   └── seed/                # Demo data population (idempotent)
│   ├── submit/                  # Artifact submission form
│   ├── review/                  # Review results display
│   └── dashboard/               # Stats and artifact timeline
├── lib/
│   ├── agents/
│   │   ├── adversarial-reviewer.ts  # Claude tool_use, SHA-256 content-hash cache
│   │   └── drift-detector.ts        # Two-step: extract signals → compare vs baseline
│   ├── gates/
│   │   ├── hard-gates.ts            # 5 blocking checks, synchronous
│   │   └── soft-gates.ts            # 6 weighted quality checks, synchronous
│   ├── schemas/
│   │   ├── prd.schema.ts            # Zod: problem, metrics, hypotheses, scope
│   │   ├── okr.schema.ts            # Zod: objectives, key results, baselines, targets
│   │   └── brief.schema.ts          # Zod: opportunity, linked OKRs, confidence
│   ├── review/
│   │   └── pipeline.ts              # Orchestrator: runs all stages, computes final score
│   └── db/
│       ├── client.ts                # better-sqlite3, WAL mode, typed query helpers
│       └── schema.sql               # Table definitions, indices, update triggers
└── data/
    ├── sample-prd-v1.json           # Demo: weak first draft — score ~35, reject, blocked
    ├── sample-prd-v2.json           # Demo: revised — score ~62, revise, gates pass
    ├── sample-prd-v3.json           # Demo: strong version — score ~85, approve
    ├── sample-okrs.json             # Demo: Q1 2025 OKRs (retention + activation quarter)
    └── sample-brief-drifted.json    # Demo: acquisition work framed as retention — drift ~78
```
