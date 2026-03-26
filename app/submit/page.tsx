"use client";

import React, { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type ArtifactType = "prd" | "okr" | "brief";

interface ValidationError {
  field: string;
  message: string;
  severity: "hard" | "soft";
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  completenessScore: number;
  fieldCoverage: Record<string, boolean>;
}

interface HardGateResult {
  passed: boolean;
  gateName: string;
  reason: string;
}

interface SoftGateResult {
  passed: boolean;
  gateName: string;
  warning: string;
  suggestion: string;
  weight: number;
}

interface AdversarialFinding {
  section: string;
  findingType: string;
  description: string;
  suggestedQuestion: string;
  severity: 1 | 2 | 3;
}

interface AdversarialReview {
  overallRisk: "low" | "medium" | "high" | "critical";
  findings: AdversarialFinding[];
  redFlags: string[];
  strengthSignals: string[];
}

interface ReviewReport {
  artifactId: string | null;
  artifactName: string;
  artifactType: string;
  timestamp: string;
  hardGates: HardGateResult[];
  softGates: SoftGateResult[];
  adversarialReview: AdversarialReview;
  qualityScore: number;
  recommendation: "approve" | "revise" | "reject";
  blocked: boolean;
}

// ── Form data types ───────────────────────────────────────────────────────────

interface SuccessMetricDraft {
  metric: string;
  baseline: string;
  target: string;
  measurementMethod: string;
}

interface HypothesisDraft {
  assumption: string;
  validationMethod: string;
  riskLevel: "low" | "medium" | "high";
}

interface KeyResultDraft {
  kr: string;
  metric: string;
  currentValue: string;
  targetValue: string;
  dueDate: string;
}

interface PRDFormData {
  title: string;
  problemStatement: string;
  targetUser: {
    segment: string;
    painPoints: string[];
    jobToBeDone: string;
  };
  successMetrics: SuccessMetricDraft[];
  outOfScope: string[];
  hypotheses: HypothesisDraft[];
  dependencies: string[];
  artifactVersion: string;
}

interface OKRFormData {
  objective: string;
  keyResults: KeyResultDraft[];
  timeframe: { quarter: "Q1" | "Q2" | "Q3" | "Q4"; year: string };
  owner: string;
}

interface BriefFormData {
  opportunity: string;
  proposedSolution: string;
  linkedOKRs: string[];
  estimatedImpact: string;
  confidence: "low" | "medium" | "high";
}

// ── Default state factories ───────────────────────────────────────────────────

function defaultPRD(): PRDFormData {
  return {
    title: "",
    problemStatement: "",
    targetUser: { segment: "", painPoints: [""], jobToBeDone: "" },
    successMetrics: [{ metric: "", baseline: "", target: "", measurementMethod: "" }],
    outOfScope: ["", ""],
    hypotheses: [{ assumption: "", validationMethod: "", riskLevel: "medium" }],
    dependencies: [],
    artifactVersion: "1.0.0",
  };
}

function defaultOKR(): OKRFormData {
  return {
    objective: "",
    keyResults: [
      { kr: "", metric: "", currentValue: "0", targetValue: "0", dueDate: "" },
      { kr: "", metric: "", currentValue: "0", targetValue: "0", dueDate: "" },
    ],
    timeframe: { quarter: "Q2", year: String(new Date().getFullYear()) },
    owner: "",
  };
}

function defaultBrief(): BriefFormData {
  return {
    opportunity: "",
    proposedSolution: "",
    linkedOKRs: [],
    estimatedImpact: "",
    confidence: "medium",
  };
}

// ── Serializers: form state → API payload ─────────────────────────────────────

function serializePRD(data: PRDFormData) {
  return {
    title: data.title,
    problemStatement: data.problemStatement,
    targetUser: {
      segment: data.targetUser.segment,
      painPoints: data.targetUser.painPoints.filter((p) => p.trim()),
      jobToBeDone: data.targetUser.jobToBeDone,
    },
    successMetrics: data.successMetrics,
    outOfScope: data.outOfScope.filter((s) => s.trim()),
    hypotheses: data.hypotheses,
    dependencies: data.dependencies.filter((d) => d.trim()),
    artifactVersion: data.artifactVersion,
  };
}

function serializeOKR(data: OKRFormData) {
  return {
    objective: data.objective,
    keyResults: data.keyResults.map((kr) => ({
      kr: kr.kr,
      metric: kr.metric,
      currentValue: Number(kr.currentValue) || 0,
      targetValue: Number(kr.targetValue) || 0,
      dueDate: kr.dueDate,
    })),
    timeframe: {
      quarter: data.timeframe.quarter,
      year: Number(data.timeframe.year) || new Date().getFullYear(),
    },
    owner: data.owner,
  };
}

function serializeBrief(data: BriefFormData) {
  return {
    opportunity: data.opportunity,
    proposedSolution: data.proposedSolution,
    linkedOKRs: data.linkedOKRs.filter((o) => o.trim()),
    estimatedImpact: data.estimatedImpact,
    confidence: data.confidence,
  };
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function FieldError({ errors, field }: { errors: ValidationError[]; field: string }) {
  const relevant = errors.filter(
    (e) =>
      e.field === field ||
      e.field.startsWith(field + ".") ||
      e.field.startsWith(field + "[")
  );
  if (!relevant.length) return null;
  return (
    <div className="mt-1.5 space-y-0.5">
      {relevant.map((e, i) => (
        <p
          key={i}
          className={cn(
            "text-xs",
            e.severity === "hard" ? "text-destructive" : "text-amber-600"
          )}
        >
          {e.severity === "hard" ? "✕ " : "⚠ "}
          {e.message}
        </p>
      ))}
    </div>
  );
}

function FL({
  children,
  required,
}: {
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <Label className="text-sm font-medium">
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </Label>
  );
}

function SecHead({
  title,
  sub,
}: {
  title: string;
  sub?: string;
}) {
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:text-destructive transition-colors text-sm leading-none px-1"
      aria-label="Remove"
    >
      ✕
    </button>
  );
}

// ── PRD Form ──────────────────────────────────────────────────────────────────

function PRDForm({
  data,
  errors,
  onChange,
}: {
  data: PRDFormData;
  errors: ValidationError[];
  onChange: (d: PRDFormData) => void;
}) {
  const set = (patch: Partial<PRDFormData>) => onChange({ ...data, ...patch });
  const setTU = (patch: Partial<PRDFormData["targetUser"]>) =>
    set({ targetUser: { ...data.targetUser, ...patch } });

  return (
    <div className="space-y-9">
      {/* Title */}
      <div className="space-y-1.5">
        <FL required>Title</FL>
        <Input
          value={data.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="e.g., Dashboard Preset Saves for SMB Finance Managers"
          className={cn(
            errors.some((e) => e.field === "title" && e.severity === "hard") &&
              "border-destructive focus-visible:ring-destructive"
          )}
        />
        <p className="text-xs text-muted-foreground">
          Min 10 chars — describe what this PRD covers.
        </p>
        <FieldError errors={errors} field="title" />
      </div>

      {/* Problem Statement */}
      <div className="space-y-1.5">
        <FL required>Problem Statement</FL>
        <Textarea
          value={data.problemStatement}
          onChange={(e) => set({ problemStatement: e.target.value })}
          placeholder="Who is affected, how often, and what does the current workaround cost them? Include quantitative evidence."
          rows={5}
          className={cn(
            errors.some(
              (e) => e.field === "problemStatement" && e.severity === "hard"
            ) && "border-destructive focus-visible:ring-destructive"
          )}
        />
        <p className="text-xs text-muted-foreground flex items-center justify-between">
          <span>Min 100 chars. Include evidence, scope, and frequency.</span>
          <span
            className={cn(
              "font-mono tabular-nums",
              data.problemStatement.length >= 100
                ? "text-green-600"
                : data.problemStatement.length >= 50
                ? "text-amber-600"
                : "text-muted-foreground"
            )}
          >
            {data.problemStatement.length} / 100
          </span>
        </p>
        <FieldError errors={errors} field="problemStatement" />
      </div>

      {/* Target User */}
      <div className="space-y-5">
        <SecHead
          title="Target User"
          sub="Who exactly is affected and what do they need?"
        />
        <div className="space-y-1.5">
          <FL required>Segment</FL>
          <Input
            value={data.targetUser.segment}
            onChange={(e) => setTU({ segment: e.target.value })}
            placeholder="e.g., SMB finance managers at companies with <50 employees"
          />
          <FieldError errors={errors} field="targetUser.segment" />
        </div>

        <div className="space-y-1.5">
          <FL required>Pain Points</FL>
          <div className="space-y-2">
            {data.targetUser.painPoints.map((pt, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input
                  value={pt}
                  onChange={(e) => {
                    const next = [...data.targetUser.painPoints];
                    next[i] = e.target.value;
                    setTU({ painPoints: next });
                  }}
                  placeholder={`Pain point ${i + 1}`}
                />
                {data.targetUser.painPoints.length > 1 && (
                  <RemoveBtn
                    onClick={() =>
                      setTU({
                        painPoints: data.targetUser.painPoints.filter(
                          (_, idx) => idx !== i
                        ),
                      })
                    }
                  />
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setTU({ painPoints: [...data.targetUser.painPoints, ""] })
              }
            >
              + Add pain point
            </Button>
          </div>
          <FieldError errors={errors} field="targetUser.painPoints" />
        </div>

        <div className="space-y-1.5">
          <FL required>Job to Be Done</FL>
          <Textarea
            value={data.targetUser.jobToBeDone}
            onChange={(e) => setTU({ jobToBeDone: e.target.value })}
            placeholder="The underlying goal the user is trying to accomplish — not just the surface pain."
            rows={2}
          />
          <FieldError errors={errors} field="targetUser.jobToBeDone" />
        </div>
      </div>

      {/* Success Metrics */}
      <div className="space-y-4">
        <SecHead
          title="Success Metrics"
          sub="How will you measure success? At least 2 required with numeric targets."
        />
        {data.successMetrics.map((m, i) => (
          <Card key={i} className="relative border-dashed">
            {data.successMetrics.length > 1 && (
              <div className="absolute top-3 right-3">
                <RemoveBtn
                  onClick={() =>
                    set({
                      successMetrics: data.successMetrics.filter(
                        (_, idx) => idx !== i
                      ),
                    })
                  }
                />
              </div>
            )}
            <CardContent className="pt-4 grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <FL required>Metric Name</FL>
                <Input
                  value={m.metric}
                  onChange={(e) => {
                    const next = [...data.successMetrics];
                    next[i] = { ...next[i], metric: e.target.value };
                    set({ successMetrics: next });
                  }}
                  placeholder="e.g., Dashboard session time"
                />
              </div>
              <div className="space-y-1">
                <FL required>Baseline</FL>
                <Input
                  value={m.baseline}
                  onChange={(e) => {
                    const next = [...data.successMetrics];
                    next[i] = { ...next[i], baseline: e.target.value };
                    set({ successMetrics: next });
                  }}
                  placeholder="Current value"
                />
              </div>
              <div className="space-y-1">
                <FL required>Target</FL>
                <Input
                  value={m.target}
                  onChange={(e) => {
                    const next = [...data.successMetrics];
                    next[i] = { ...next[i], target: e.target.value };
                    set({ successMetrics: next });
                  }}
                  placeholder="e.g., 4 min, 85%, 1200"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <FL required>Measurement Method</FL>
                <Input
                  value={m.measurementMethod}
                  onChange={(e) => {
                    const next = [...data.successMetrics];
                    next[i] = {
                      ...next[i],
                      measurementMethod: e.target.value,
                    };
                    set({ successMetrics: next });
                  }}
                  placeholder="e.g., Mixpanel → dashboard_session_end, p50 duration, /dashboard only"
                />
              </div>
            </CardContent>
          </Card>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            set({
              successMetrics: [
                ...data.successMetrics,
                { metric: "", baseline: "", target: "", measurementMethod: "" },
              ],
            })
          }
        >
          + Add metric
        </Button>
        <FieldError errors={errors} field="successMetrics" />
      </div>

      {/* Out of Scope */}
      <div className="space-y-3">
        <SecHead
          title="Out of Scope"
          sub="What does this PRD explicitly NOT cover? Min 2 required."
        />
        <div className="space-y-2">
          {data.outOfScope.map((item, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input
                value={item}
                onChange={(e) => {
                  const next = [...data.outOfScope];
                  next[i] = e.target.value;
                  set({ outOfScope: next });
                }}
                placeholder={`Out-of-scope item ${i + 1}`}
              />
              {data.outOfScope.length > 2 && (
                <RemoveBtn
                  onClick={() =>
                    set({
                      outOfScope: data.outOfScope.filter((_, idx) => idx !== i),
                    })
                  }
                />
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => set({ outOfScope: [...data.outOfScope, ""] })}
          >
            + Add item
          </Button>
        </div>
        <FieldError errors={errors} field="outOfScope" />
      </div>

      {/* Hypotheses */}
      <div className="space-y-4">
        <SecHead
          title="Hypotheses"
          sub="What assumptions must be true for this PRD to deliver value?"
        />
        {data.hypotheses.map((h, i) => (
          <Card key={i} className="relative border-dashed">
            {data.hypotheses.length > 1 && (
              <div className="absolute top-3 right-3">
                <RemoveBtn
                  onClick={() =>
                    set({
                      hypotheses: data.hypotheses.filter((_, idx) => idx !== i),
                    })
                  }
                />
              </div>
            )}
            <CardContent className="pt-4 space-y-3">
              <div className="space-y-1">
                <FL required>Assumption</FL>
                <Textarea
                  value={h.assumption}
                  onChange={(e) => {
                    const next = [...data.hypotheses];
                    next[i] = { ...next[i], assumption: e.target.value };
                    set({ hypotheses: next });
                  }}
                  placeholder="e.g., Users will adopt preset saves within 2 weeks of launch"
                  rows={2}
                />
              </div>
              <div className="space-y-1">
                <FL required>Validation Method</FL>
                <Textarea
                  value={h.validationMethod}
                  onChange={(e) => {
                    const next = [...data.hypotheses];
                    next[i] = { ...next[i], validationMethod: e.target.value };
                    set({ hypotheses: next });
                  }}
                  placeholder="How will you test or invalidate this? (tool, event, timeline)"
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <FL required>Risk Level</FL>
                <div className="flex gap-2">
                  {(["low", "medium", "high"] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => {
                        const next = [...data.hypotheses];
                        next[i] = { ...next[i], riskLevel: level };
                        set({ hypotheses: next });
                      }}
                      className={cn(
                        "px-3 py-1 rounded text-xs font-medium border transition-colors",
                        h.riskLevel === level
                          ? level === "low"
                            ? "bg-green-100 border-green-400 text-green-800"
                            : level === "medium"
                            ? "bg-amber-100 border-amber-400 text-amber-800"
                            : "bg-red-100 border-red-400 text-red-800"
                          : "bg-background border-border text-muted-foreground hover:bg-accent"
                      )}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            set({
              hypotheses: [
                ...data.hypotheses,
                { assumption: "", validationMethod: "", riskLevel: "medium" },
              ],
            })
          }
        >
          + Add hypothesis
        </Button>
        <FieldError errors={errors} field="hypotheses" />
      </div>

      {/* Dependencies */}
      <div className="space-y-3">
        <SecHead
          title="Dependencies"
          sub="External teams, systems, or decisions this work depends on."
        />
        <div className="space-y-2">
          {data.dependencies.map((dep, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input
                value={dep}
                onChange={(e) => {
                  const next = [...data.dependencies];
                  next[i] = e.target.value;
                  set({ dependencies: next });
                }}
                placeholder="e.g., Auth team API v2, Design system tokens"
              />
              <RemoveBtn
                onClick={() =>
                  set({
                    dependencies: data.dependencies.filter(
                      (_, idx) => idx !== i
                    ),
                  })
                }
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => set({ dependencies: [...data.dependencies, ""] })}
          >
            + Add dependency
          </Button>
        </div>
        <FieldError errors={errors} field="dependencies" />
      </div>

      {/* Version */}
      <div className="space-y-1.5">
        <FL required>Artifact Version</FL>
        <Input
          value={data.artifactVersion}
          onChange={(e) => set({ artifactVersion: e.target.value })}
          placeholder="1.0.0"
          className="w-32"
        />
        <p className="text-xs text-muted-foreground">
          Semver format — e.g., 1.0.0 or 2.1.3
        </p>
        <FieldError errors={errors} field="artifactVersion" />
      </div>
    </div>
  );
}

// ── OKR Form ──────────────────────────────────────────────────────────────────

function OKRForm({
  data,
  errors,
  onChange,
}: {
  data: OKRFormData;
  errors: ValidationError[];
  onChange: (d: OKRFormData) => void;
}) {
  const set = (patch: Partial<OKRFormData>) => onChange({ ...data, ...patch });

  return (
    <div className="space-y-9">
      {/* Objective */}
      <div className="space-y-1.5">
        <FL required>Objective</FL>
        <Textarea
          value={data.objective}
          onChange={(e) => set({ objective: e.target.value })}
          placeholder="What does 'winning' look like this quarter? Keep it inspirational and directional."
          rows={3}
        />
        <FieldError errors={errors} field="objective" />
      </div>

      {/* Key Results */}
      <div className="space-y-4">
        <SecHead
          title="Key Results"
          sub="2–5 measurable outcomes that prove the objective was achieved."
        />
        {data.keyResults.map((kr, i) => (
          <Card key={i} className="relative border-dashed">
            {data.keyResults.length > 2 && (
              <div className="absolute top-3 right-3">
                <RemoveBtn
                  onClick={() =>
                    set({
                      keyResults: data.keyResults.filter((_, idx) => idx !== i),
                    })
                  }
                />
              </div>
            )}
            <CardContent className="pt-4 space-y-3">
              <div className="space-y-1">
                <FL required>Key Result {i + 1}</FL>
                <Textarea
                  value={kr.kr}
                  onChange={(e) => {
                    const next = [...data.keyResults];
                    next[i] = { ...next[i], kr: e.target.value };
                    set({ keyResults: next });
                  }}
                  placeholder="Increase [metric] from [current] to [target] by [date]"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <FL required>Metric</FL>
                  <Input
                    value={kr.metric}
                    onChange={(e) => {
                      const next = [...data.keyResults];
                      next[i] = { ...next[i], metric: e.target.value };
                      set({ keyResults: next });
                    }}
                    placeholder="weekly_active_users"
                  />
                </div>
                <div className="space-y-1">
                  <FL required>Due Date</FL>
                  <Input
                    type="date"
                    value={kr.dueDate}
                    onChange={(e) => {
                      const next = [...data.keyResults];
                      next[i] = { ...next[i], dueDate: e.target.value };
                      set({ keyResults: next });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <FL required>Current Value</FL>
                  <Input
                    type="number"
                    value={kr.currentValue}
                    onChange={(e) => {
                      const next = [...data.keyResults];
                      next[i] = { ...next[i], currentValue: e.target.value };
                      set({ keyResults: next });
                    }}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <FL required>Target Value</FL>
                  <Input
                    type="number"
                    value={kr.targetValue}
                    onChange={(e) => {
                      const next = [...data.keyResults];
                      next[i] = { ...next[i], targetValue: e.target.value };
                      set({ keyResults: next });
                    }}
                    placeholder="100"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {data.keyResults.length < 5 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              set({
                keyResults: [
                  ...data.keyResults,
                  {
                    kr: "",
                    metric: "",
                    currentValue: "0",
                    targetValue: "0",
                    dueDate: "",
                  },
                ],
              })
            }
          >
            + Add key result
          </Button>
        )}
        <FieldError errors={errors} field="keyResults" />
      </div>

      {/* Timeframe */}
      <div className="space-y-3">
        <SecHead title="Timeframe" />
        <div className="flex flex-wrap gap-6">
          <div className="space-y-1.5">
            <FL required>Quarter</FL>
            <div className="flex gap-2">
              {(["Q1", "Q2", "Q3", "Q4"] as const).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() =>
                    set({ timeframe: { ...data.timeframe, quarter: q } })
                  }
                  className={cn(
                    "px-3 py-1.5 rounded text-sm font-semibold border transition-colors",
                    data.timeframe.quarter === q
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <FL required>Year</FL>
            <Input
              type="number"
              value={data.timeframe.year}
              onChange={(e) =>
                set({ timeframe: { ...data.timeframe, year: e.target.value } })
              }
              className="w-24"
              min={2020}
              max={2100}
            />
          </div>
        </div>
        <FieldError errors={errors} field="timeframe" />
      </div>

      {/* Owner */}
      <div className="space-y-1.5">
        <FL required>Owner</FL>
        <Input
          value={data.owner}
          onChange={(e) => set({ owner: e.target.value })}
          placeholder="Full name or team identifier"
        />
        <FieldError errors={errors} field="owner" />
      </div>
    </div>
  );
}

// ── Brief Form ─────────────────────────────────────────────────────────────────

function BriefForm({
  data,
  errors,
  onChange,
}: {
  data: BriefFormData;
  errors: ValidationError[];
  onChange: (d: BriefFormData) => void;
}) {
  const set = (patch: Partial<BriefFormData>) => onChange({ ...data, ...patch });

  return (
    <div className="space-y-9">
      {/* Opportunity */}
      <div className="space-y-1.5">
        <FL required>Opportunity</FL>
        <Textarea
          value={data.opportunity}
          onChange={(e) => set({ opportunity: e.target.value })}
          placeholder="What user pain or market gap are you exploring? Frame as an opportunity, not a solution."
          rows={4}
        />
        <FieldError errors={errors} field="opportunity" />
      </div>

      {/* Proposed Solution */}
      <div className="space-y-1.5">
        <FL required>Proposed Solution</FL>
        <Textarea
          value={data.proposedSolution}
          onChange={(e) => set({ proposedSolution: e.target.value })}
          placeholder="By doing X, we believe Y will happen. This is a hypothesis, not a commitment."
          rows={4}
        />
        <FieldError errors={errors} field="proposedSolution" />
      </div>

      {/* Linked OKRs */}
      <div className="space-y-3">
        <SecHead
          title="Linked OKRs"
          sub="Connect this brief to strategic goals. At least 1 required to pass hard gates."
        />
        <div className="space-y-2">
          {data.linkedOKRs.map((okr, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input
                value={okr}
                onChange={(e) => {
                  const next = [...data.linkedOKRs];
                  next[i] = e.target.value;
                  set({ linkedOKRs: next });
                }}
                placeholder="OKR identifier or name"
              />
              <RemoveBtn
                onClick={() =>
                  set({
                    linkedOKRs: data.linkedOKRs.filter((_, idx) => idx !== i),
                  })
                }
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => set({ linkedOKRs: [...data.linkedOKRs, ""] })}
          >
            + Link OKR
          </Button>
        </div>
        <FieldError errors={errors} field="linkedOKRs" />
      </div>

      {/* Estimated Impact */}
      <div className="space-y-1.5">
        <FL required>Estimated Impact</FL>
        <Textarea
          value={data.estimatedImpact}
          onChange={(e) => set({ estimatedImpact: e.target.value })}
          placeholder="What does success look like? Quantify if possible — e.g., 'could reduce churn by ~5%'."
          rows={3}
        />
        <FieldError errors={errors} field="estimatedImpact" />
      </div>

      {/* Confidence */}
      <div className="space-y-2">
        <FL required>Confidence Level</FL>
        <div className="grid grid-cols-3 gap-3">
          {(["low", "medium", "high"] as const).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => set({ confidence: level })}
              className={cn(
                "py-3 px-4 rounded-lg border text-sm font-medium transition-colors text-left",
                data.confidence === level
                  ? level === "low"
                    ? "bg-blue-50 border-blue-400 text-blue-800"
                    : level === "medium"
                    ? "bg-amber-50 border-amber-400 text-amber-800"
                    : "bg-green-50 border-green-400 text-green-800"
                  : "bg-background border-border text-muted-foreground hover:bg-accent"
              )}
            >
              <div className="font-semibold capitalize">{level}</div>
              <div className="text-xs mt-0.5 opacity-70">
                {level === "low"
                  ? "Needs validation"
                  : level === "medium"
                  ? "Some evidence"
                  : "Strong signal"}
              </div>
            </button>
          ))}
        </div>
        <FieldError errors={errors} field="confidence" />
      </div>
    </div>
  );
}

// ── Quality Panel ─────────────────────────────────────────────────────────────

function QualityPanel({
  validation,
  isValidating,
}: {
  validation: ValidationResult | null;
  isValidating: boolean;
}) {
  const hardErrors = validation?.errors.filter((e) => e.severity === "hard") ?? [];
  const softWarnings = validation?.errors.filter((e) => e.severity === "soft") ?? [];
  const score = validation?.completenessScore ?? 0;

  return (
    <div className="space-y-4">
      {/* Completeness Score */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
            Completeness
            {isValidating && (
              <span className="text-xs font-normal animate-pulse">
                Checking…
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {!validation ? (
            <p className="text-xs text-muted-foreground">
              Start filling the form to see your score.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-end gap-2">
                <span
                  className={cn(
                    "text-4xl font-bold tabular-nums leading-none",
                    score >= 80
                      ? "text-green-600"
                      : score >= 60
                      ? "text-amber-600"
                      : "text-destructive"
                  )}
                >
                  {score}
                </span>
                <span className="text-muted-foreground text-sm mb-0.5">/ 100</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    score >= 80
                      ? "bg-green-500"
                      : score >= 60
                      ? "bg-amber-500"
                      : "bg-destructive"
                  )}
                  style={{ width: `${score}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {score >= 80
                  ? "Looking solid"
                  : score >= 60
                  ? "More detail will help"
                  : "Needs significant work"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hard Gates */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            Hard Gates
            {hardErrors.length > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 rounded-sm">
                {hardErrors.length} blocking
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {!validation ? (
            <p className="text-xs text-muted-foreground">
              Fill in the form to check gates.
            </p>
          ) : hardErrors.length === 0 ? (
            <div className="flex items-center gap-2 text-green-600 text-xs font-medium">
              <span>✓</span>
              <span>All schema requirements met</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              {hardErrors.map((e, i) => (
                <div key={i} className="text-xs space-y-0.5">
                  <div className="flex gap-1.5">
                    <span className="text-destructive shrink-0 mt-px">✕</span>
                    <span className="font-mono text-muted-foreground text-[10px] leading-4 pt-px">
                      {e.field}
                    </span>
                  </div>
                  <p className="text-foreground pl-4">{e.message}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Soft Warnings */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            Quality Hints
            {softWarnings.length > 0 && (
              <Badge variant="warning" className="text-[10px] px-1.5 py-0 rounded-sm">
                {softWarnings.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {!validation ? (
            <p className="text-xs text-muted-foreground">
              Soft warnings will appear here.
            </p>
          ) : softWarnings.length === 0 ? (
            <div className="flex items-center gap-2 text-green-600 text-xs font-medium">
              <span>✓</span>
              <span>No quality warnings</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              {softWarnings.map((e, i) => (
                <div key={i} className="text-xs space-y-0.5">
                  <div className="flex gap-1.5">
                    <span className="text-amber-600 shrink-0 mt-px">⚠</span>
                    <span className="font-mono text-muted-foreground text-[10px] leading-4 pt-px">
                      {e.field}
                    </span>
                  </div>
                  <p className="text-foreground pl-4">{e.message}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Blocking message */}
      {validation && hardErrors.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-xs text-destructive font-medium">
          Fix {hardErrors.length} blocking error
          {hardErrors.length !== 1 ? "s" : ""} above to enable review.
        </div>
      )}
    </div>
  );
}

// ── Progress Overlay ──────────────────────────────────────────────────────────

type SubmitPhase =
  | "idle"
  | "validating"
  | "gates"
  | "adversarial"
  | "drift"
  | "complete"
  | "error";

const STEPS: { phase: SubmitPhase; label: string }[] = [
  { phase: "validating", label: "Running schema validation..." },
  { phase: "gates", label: "Applying quality gates..." },
  { phase: "adversarial", label: "Running adversarial review..." },
  { phase: "drift", label: "Checking drift..." },
  { phase: "complete", label: "Complete" },
];

const PHASE_IDX: Record<SubmitPhase, number> = {
  idle: -1,
  validating: 0,
  gates: 1,
  adversarial: 2,
  drift: 3,
  complete: 4,
  error: -1,
};

function ProgressOverlay({ phase }: { phase: SubmitPhase }) {
  if (phase === "idle" || phase === "error") return null;
  const currentIdx = PHASE_IDX[phase];

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-sm shadow-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Reviewing your artifact…</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pb-6">
          {STEPS.map(({ phase: stepPhase, label }, i) => {
            const done = currentIdx > i;
            const active = currentIdx === i;
            return (
              <div
                key={stepPhase}
                className={cn(
                  "flex items-center gap-3 text-sm transition-opacity duration-300",
                  !done && !active && "opacity-35"
                )}
              >
                <span className="w-5 h-5 shrink-0 flex items-center justify-center">
                  {done ? (
                    <span className="text-green-600 text-base">✓</span>
                  ) : active ? (
                    <span
                      className="block w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin"
                      aria-hidden
                    />
                  ) : (
                    <span className="block w-2 h-2 rounded-full bg-muted-foreground/30 mx-auto" />
                  )}
                </span>
                <span
                  className={cn(
                    done
                      ? "text-muted-foreground line-through"
                      : active
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Review Results ────────────────────────────────────────────────────────────

function ReviewResults({
  report,
  onReset,
}: {
  report: ReviewReport;
  onReset: () => void;
}) {
  const rec = report.recommendation;
  const recStyles = {
    approve:
      "border-green-300 bg-green-50 text-green-800",
    revise:
      "border-amber-300 bg-amber-50 text-amber-800",
    reject:
      "border-red-300 bg-red-50 text-red-800",
  }[rec];

  const recIcon = { approve: "✓", revise: "↻", reject: "✕" }[rec];
  const recLabel = {
    approve: "Approved — ready to proceed",
    revise: "Needs revision before proceeding",
    reject: "Rejected — critical issues must be resolved",
  }[rec];

  const riskStyles = {
    low: "bg-green-100 text-green-800",
    medium: "bg-amber-100 text-amber-800",
    high: "bg-red-100 text-red-800",
    critical: "bg-red-900 text-red-100",
  }[report.adversarialReview.overallRisk];

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Review Complete</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {report.artifactName} ·{" "}
            <span className="capitalize">{report.artifactType}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onReset}>
          ← Submit another
        </Button>
      </div>

      {/* Verdict banner */}
      <div
        className={cn(
          "rounded-xl border-2 px-6 py-5 flex items-center justify-between gap-4",
          recStyles
        )}
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold">{recIcon}</span>
          <div>
            <div className="font-bold text-lg uppercase tracking-wide">{rec}</div>
            <div className="text-sm opacity-75 mt-0.5">{recLabel}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-4xl font-bold tabular-nums">
            {report.qualityScore}
          </div>
          <div className="text-xs opacity-60 mt-0.5">quality score</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Hard Gates */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Hard Gates
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {report.hardGates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hard gates for this artifact type.
              </p>
            ) : (
              report.hardGates.map((g, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-2.5 text-xs p-2.5 rounded-lg",
                    g.passed ? "bg-green-50" : "bg-red-50"
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 mt-px font-bold",
                      g.passed ? "text-green-600" : "text-red-600"
                    )}
                  >
                    {g.passed ? "✓" : "✕"}
                  </span>
                  <div className="space-y-0.5">
                    <p className="font-mono font-semibold text-foreground">
                      {g.gateName}
                    </p>
                    <p
                      className={
                        g.passed ? "text-green-700" : "text-red-700"
                      }
                    >
                      {g.reason}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Soft Gates */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Quality Gates
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {report.softGates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No soft gates for this artifact type.
              </p>
            ) : (
              report.softGates.map((g, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-2.5 text-xs p-2.5 rounded-lg",
                    g.passed ? "bg-green-50" : "bg-amber-50"
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 mt-px",
                      g.passed ? "text-green-600" : "text-amber-600"
                    )}
                  >
                    {g.passed ? "✓" : "⚠"}
                  </span>
                  <div className="space-y-0.5">
                    <p className="font-mono font-semibold text-foreground">
                      {g.gateName}
                    </p>
                    <p
                      className={
                        g.passed ? "text-green-700" : "text-amber-700"
                      }
                    >
                      {g.passed ? g.warning : g.suggestion}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Adversarial Review */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
            Adversarial Review
            <span
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-full font-semibold normal-case tracking-normal",
                riskStyles
              )}
            >
              {report.adversarialReview.overallRisk} risk
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-5">
          {report.adversarialReview.redFlags.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-destructive mb-2">
                Red Flags
              </p>
              <ul className="space-y-1.5">
                {report.adversarialReview.redFlags.map((flag, i) => (
                  <li key={i} className="flex gap-2 text-xs text-red-700">
                    <span className="shrink-0">🚩</span>
                    <span>{flag}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.adversarialReview.findings.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-foreground mb-2">
                Findings
              </p>
              <div className="space-y-2">
                {report.adversarialReview.findings.map((f, i) => (
                  <div
                    key={i}
                    className={cn(
                      "p-3 rounded-lg text-xs border-l-2",
                      f.severity === 3
                        ? "border-red-500 bg-red-50"
                        : f.severity === 2
                        ? "border-amber-500 bg-amber-50"
                        : "border-blue-400 bg-blue-50"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono font-semibold text-foreground">
                        {f.section}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[9px] px-1 py-0 font-normal"
                      >
                        {f.findingType}
                      </Badge>
                    </div>
                    <p className="text-foreground">{f.description}</p>
                    <p className="text-muted-foreground mt-1.5 italic">
                      Q: {f.suggestedQuestion}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.adversarialReview.strengthSignals.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-green-700 mb-2">
                Strengths
              </p>
              <ul className="space-y-1.5">
                {report.adversarialReview.strengthSignals.map((s, i) => (
                  <li key={i} className="flex gap-2 text-xs text-green-700">
                    <span className="shrink-0">✓</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.adversarialReview.findings.length === 0 &&
            report.adversarialReview.redFlags.length === 0 &&
            report.adversarialReview.strengthSignals.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No adversarial findings for this artifact type.
              </p>
            )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SubmitPage() {
  const [artifactType, setArtifactType] = useState<ArtifactType>("prd");

  // Per-type form state — preserved when switching types
  const [prdData, setPrdData] = useState<PRDFormData>(defaultPRD);
  const [okrData, setOkrData] = useState<OKRFormData>(defaultOKR);
  const [briefData, setBriefData] = useState<BriefFormData>(defaultBrief);

  // Validation
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Submit
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>("idle");
  const [reviewReport, setReviewReport] = useState<ReviewReport | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Debounced validation ──────────────────────────────────────────────────

  const runValidation = useCallback(
    async (type: ArtifactType, content: unknown) => {
      try {
        const res = await fetch("/api/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artifactType: type, content }),
        });
        if (res.ok) setValidation(await res.json());
      } catch {
        // ignore network errors during live validation
      } finally {
        setIsValidating(false);
      }
    },
    []
  );

  const scheduleValidation = useCallback(
    (type: ArtifactType, content: unknown) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setIsValidating(true);
      debounceRef.current = setTimeout(() => runValidation(type, content), 400);
    },
    [runValidation]
  );

  // ── Change handlers ───────────────────────────────────────────────────────

  function handlePRDChange(data: PRDFormData) {
    setPrdData(data);
    scheduleValidation("prd", serializePRD(data));
  }

  function handleOKRChange(data: OKRFormData) {
    setOkrData(data);
    scheduleValidation("okr", serializeOKR(data));
  }

  function handleBriefChange(data: BriefFormData) {
    setBriefData(data);
    scheduleValidation("brief", serializeBrief(data));
  }

  function handleTypeChange(type: ArtifactType) {
    setArtifactType(type);
    setValidation(null);
    const content =
      type === "prd"
        ? serializePRD(prdData)
        : type === "okr"
        ? serializeOKR(okrData)
        : serializeBrief(briefData);
    scheduleValidation(type, content);
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  const hardErrors =
    validation?.errors.filter((e) => e.severity === "hard") ?? [];
  const canSubmit =
    validation?.valid === true &&
    hardErrors.length === 0 &&
    submitPhase === "idle";

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitError(null);

    // Advance progress steps, then fire the API call during the slow step
    setSubmitPhase("validating");
    await new Promise((r) => setTimeout(r, 350));
    setSubmitPhase("gates");
    await new Promise((r) => setTimeout(r, 500));
    setSubmitPhase("adversarial");

    try {
      let report: ReviewReport;

      if (artifactType === "prd") {
        // PRD gets the full adversarial review pipeline
        const content = { artifactType: "prd" as const, ...serializePRD(prdData) };
        const res = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            (err as { error?: string }).error ?? "Review pipeline failed"
          );
        }
        report = await res.json();
      } else {
        // OKR / Brief: validation-only review (adversarial pipeline is PRD-only)
        const content =
          artifactType === "okr"
            ? serializeOKR(okrData)
            : serializeBrief(briefData);
        const res = await fetch("/api/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artifactType, content }),
        });
        const val: ValidationResult & { meta?: unknown } = await res.json();

        const name =
          artifactType === "okr"
            ? okrData.objective.trim().slice(0, 60) || "Untitled OKR"
            : briefData.opportunity.trim().slice(0, 60) || "Untitled Brief";

        // Synthesise a ReviewReport from validation results
        report = {
          artifactId: null,
          artifactName: name,
          artifactType,
          timestamp: new Date().toISOString(),
          hardGates: [],
          softGates: [],
          adversarialReview: {
            overallRisk: val.valid ? "low" : "medium",
            findings: [],
            redFlags: val.errors
              .filter((e) => e.severity === "hard")
              .map((e) => `${e.field}: ${e.message}`)
              .slice(0, 3),
            strengthSignals: val.valid
              ? [
                  "Schema validation passed",
                  `Completeness score: ${val.completenessScore}%`,
                ]
              : [],
          },
          qualityScore: val.completenessScore,
          recommendation: val.valid ? "approve" : "revise",
          blocked: !val.valid,
        };
      }

      setSubmitPhase("drift");
      await new Promise((r) => setTimeout(r, 500));
      setSubmitPhase("complete");
      await new Promise((r) => setTimeout(r, 600));

      // Store for /review page and show inline
      sessionStorage.setItem("lastReviewReport", JSON.stringify(report));
      setReviewReport(report);
      setSubmitPhase("idle");
    } catch (err) {
      setSubmitPhase("idle");
      setSubmitError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    }
  }

  // ── Render: results view ──────────────────────────────────────────────────

  if (reviewReport) {
    return (
      <main className="min-h-screen p-6 md:p-10">
        <ReviewResults
          report={reviewReport}
          onReset={() => {
            setReviewReport(null);
            setValidation(null);
            setSubmitError(null);
          }}
        />
      </main>
    );
  }

  // ── Render: form view ─────────────────────────────────────────────────────

  const validationErrors = validation?.errors ?? [];

  return (
    <main className="min-h-screen">
      <ProgressOverlay phase={submitPhase} />

      {/* Sticky header */}
      <div className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold leading-tight">Submit Artifact</h1>
            <p className="text-xs text-muted-foreground">
              Run quality gates and AI review before committing
            </p>
          </div>
          <a
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            ← Home
          </a>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-5 py-8">
        {/* Artifact type selector */}
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Artifact Type
          </p>
          <div className="flex flex-wrap gap-2">
            {(["prd", "okr", "brief"] as const).map((type) => (
              <button
                key={type}
                onClick={() => handleTypeChange(type)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold border transition-all",
                  artifactType === type
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-background text-muted-foreground border-border hover:bg-accent hover:text-foreground"
                )}
              >
                <span>{type.toUpperCase()}</span>
                <span
                  className={cn(
                    "text-xs font-normal",
                    artifactType === type ? "opacity-75" : "opacity-60"
                  )}
                >
                  {type === "prd"
                    ? "Product Requirement"
                    : type === "okr"
                    ? "Objectives & Key Results"
                    : "Discovery Brief"}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 items-start">
          {/* Left: form */}
          <div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit();
              }}
              className="space-y-8"
            >
              {artifactType === "prd" && (
                <PRDForm
                  data={prdData}
                  errors={validationErrors}
                  onChange={handlePRDChange}
                />
              )}
              {artifactType === "okr" && (
                <OKRForm
                  data={okrData}
                  errors={validationErrors}
                  onChange={handleOKRChange}
                />
              )}
              {artifactType === "brief" && (
                <BriefForm
                  data={briefData}
                  errors={validationErrors}
                  onChange={handleBriefChange}
                />
              )}

              {/* Error message */}
              {submitError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  <strong>Error:</strong> {submitError}
                </div>
              )}

              {/* Submit */}
              <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-3">
                <Button
                  type="submit"
                  size="lg"
                  disabled={!canSubmit}
                  className="sm:w-auto"
                >
                  {submitPhase !== "idle" ? (
                    <span className="flex items-center gap-2">
                      <span className="block w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                      Reviewing…
                    </span>
                  ) : (
                    "Run AI Review →"
                  )}
                </Button>
                {!validation && (
                  <p className="text-xs text-muted-foreground">
                    Fill in the form to enable review.
                  </p>
                )}
                {validation && !canSubmit && hardErrors.length > 0 && (
                  <p className="text-xs text-destructive">
                    Fix {hardErrors.length} blocking error
                    {hardErrors.length !== 1 ? "s" : ""} to enable submit.
                  </p>
                )}
                {validation && canSubmit && (
                  <p className="text-xs text-green-600 font-medium">
                    ✓ Ready to submit
                  </p>
                )}
              </div>
            </form>
          </div>

          {/* Right: quality panel — sticky on desktop */}
          <div className="lg:sticky lg:top-[73px]">
            <QualityPanel
              validation={validation}
              isValidating={isValidating}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
