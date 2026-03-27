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
  gateId?: string;
}

interface GateCoverage {
  gate1_context: boolean;
  gate2_evals: boolean;
  gate3_tco: boolean;
  gate4_nfr: boolean;
  gate5_operability: boolean;
  gate6_metrics: boolean;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  completenessScore: number;
  fieldCoverage: Record<string, boolean>;
  gateCoverage: GateCoverage;
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

interface EvidenceSignalDraft {
  signalType: "user_research" | "support_tickets" | "usage_data" | "competitive" | "customer_quote";
  description: string;
  source: string;
  quantifiedImpact: string;
}

interface SyntheticEvalDraft {
  groundednessScore: string;
  hallucinationRate: string;
  evalDatasetDescription: string;
  evalToolUsed: string;
  evalRunDate: string;
  passedEvalGate: boolean;
}

interface TCOAnalysisDraft {
  buildCostEstimate: string;
  buyCostEstimate: string;
  threeYearTCO: string;
  roiMoat: string;
  breakEvenTimeline: string;
  buildVsBuyDecision: "build" | "buy" | "hybrid";
  buildVsBuyJustification: string;
}

interface NFRDraft {
  dataResidency: string;
  complianceFrameworks: string[];
  piiHandling: string;
  explainabilityRequirement: "none" | "audit_log" | "decision_rationale" | "full_trace";
  explainabilityJustification: string;
  securityReviewRequired: boolean;
  riskOwnerSignoff: string;
}

interface OperabilityDraft {
  productionDeadline: string;
  pilotDurationDays: string;
  scopeEnforcementMechanism: string;
  scopeCreepResponsePlan: string;
  operabilityOwner: string;
  fallbackPlan: string;
}

interface SuccessMetricDraft {
  metric: string;
  baseline: string;
  target: string;
  measurementMethod: string;
  monitoringTool: string;
  degradationThreshold: string;
  degradationResponsePlan: string;
}

interface HypothesisDraft {
  assumption: string;
  validationMethod: string;
  riskLevel: "low" | "medium" | "high";
}

interface PRDFormData {
  title: string;
  artifactVersion: string;
  // Gate 1
  problemStatement: string;
  evidenceSignals: EvidenceSignalDraft[];
  targetUser: { segment: string; painPoints: string[]; jobToBeDone: string };
  // Gate 2
  syntheticEval: SyntheticEvalDraft;
  // Gate 3
  tcoAnalysis: TCOAnalysisDraft;
  // Gate 4
  nonFunctionalRequirements: NFRDraft;
  // Gate 5
  operabilityConstraints: OperabilityDraft;
  // Gate 6
  successMetrics: SuccessMetricDraft[];
  hypotheses: HypothesisDraft[];
  outOfScope: string[];
  dependencies: string[];
}

interface OKRFormData {
  objective: string;
  keyResults: { kr: string; metric: string; currentValue: string; targetValue: string; dueDate: string }[];
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

// ── Gate definitions ──────────────────────────────────────────────────────────

const GATE_DEFS: { key: keyof GateCoverage; label: string; sub: string }[] = [
  { key: "gate1_context", label: "Context Engineering", sub: "Problem · evidence · user" },
  { key: "gate2_evals", label: "Synthetic Evals", sub: "AI quality gate" },
  { key: "gate3_tco", label: "TCO & ROI Moat", sub: "Build vs buy" },
  { key: "gate4_nfr", label: "Non-Functional Reqs", sub: "Compliance · privacy" },
  { key: "gate5_operability", label: "Operability", sub: "Timeline · fallback" },
  { key: "gate6_metrics", label: "Success Metrics", sub: "Observable · actionable" },
];

// ── Default state factories ───────────────────────────────────────────────────

function defaultPRD(): PRDFormData {
  return {
    title: "",
    artifactVersion: "1.0.0",
    problemStatement: "",
    evidenceSignals: [
      { signalType: "user_research", description: "", source: "", quantifiedImpact: "" },
      { signalType: "usage_data", description: "", source: "", quantifiedImpact: "" },
    ],
    targetUser: { segment: "", painPoints: [""], jobToBeDone: "" },
    syntheticEval: {
      groundednessScore: "",
      hallucinationRate: "",
      evalDatasetDescription: "",
      evalToolUsed: "",
      evalRunDate: "",
      passedEvalGate: false,
    },
    tcoAnalysis: {
      buildCostEstimate: "",
      buyCostEstimate: "",
      threeYearTCO: "",
      roiMoat: "",
      breakEvenTimeline: "",
      buildVsBuyDecision: "build",
      buildVsBuyJustification: "",
    },
    nonFunctionalRequirements: {
      dataResidency: "",
      complianceFrameworks: [],
      piiHandling: "",
      explainabilityRequirement: "audit_log",
      explainabilityJustification: "",
      securityReviewRequired: false,
      riskOwnerSignoff: "",
    },
    operabilityConstraints: {
      productionDeadline: "",
      pilotDurationDays: "30",
      scopeEnforcementMechanism: "",
      scopeCreepResponsePlan: "",
      operabilityOwner: "",
      fallbackPlan: "",
    },
    successMetrics: [{
      metric: "", baseline: "", target: "", measurementMethod: "",
      monitoringTool: "", degradationThreshold: "", degradationResponsePlan: "",
    }],
    hypotheses: [{ assumption: "", validationMethod: "", riskLevel: "medium" }],
    outOfScope: ["", ""],
    dependencies: [],
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

// ── Serializers ───────────────────────────────────────────────────────────────

function serializePRD(data: PRDFormData) {
  return {
    title: data.title,
    artifactVersion: data.artifactVersion,
    problemStatement: data.problemStatement,
    evidenceSignals: data.evidenceSignals
      .filter((s) => s.description.trim() || s.source.trim())
      .map((s) => ({
        signalType: s.signalType,
        description: s.description,
        source: s.source,
        ...(s.quantifiedImpact.trim() ? { quantifiedImpact: s.quantifiedImpact } : {}),
      })),
    targetUser: {
      segment: data.targetUser.segment,
      painPoints: data.targetUser.painPoints.filter((p) => p.trim()),
      jobToBeDone: data.targetUser.jobToBeDone,
    },
    syntheticEval: {
      groundednessScore: Number(data.syntheticEval.groundednessScore) || 0,
      hallucinationRate: Number(data.syntheticEval.hallucinationRate) || 0,
      evalDatasetDescription: data.syntheticEval.evalDatasetDescription,
      evalToolUsed: data.syntheticEval.evalToolUsed,
      evalRunDate: data.syntheticEval.evalRunDate,
      passedEvalGate: data.syntheticEval.passedEvalGate,
    },
    tcoAnalysis: {
      buildCostEstimate: data.tcoAnalysis.buildCostEstimate,
      buyCostEstimate: data.tcoAnalysis.buyCostEstimate,
      threeYearTCO: data.tcoAnalysis.threeYearTCO,
      roiMoat: data.tcoAnalysis.roiMoat,
      breakEvenTimeline: data.tcoAnalysis.breakEvenTimeline,
      buildVsBuyDecision: data.tcoAnalysis.buildVsBuyDecision,
      buildVsBuyJustification: data.tcoAnalysis.buildVsBuyJustification,
    },
    nonFunctionalRequirements: {
      dataResidency: data.nonFunctionalRequirements.dataResidency,
      complianceFrameworks: data.nonFunctionalRequirements.complianceFrameworks.filter((f) => f.trim()),
      piiHandling: data.nonFunctionalRequirements.piiHandling,
      explainabilityRequirement: data.nonFunctionalRequirements.explainabilityRequirement,
      explainabilityJustification: data.nonFunctionalRequirements.explainabilityJustification,
      securityReviewRequired: data.nonFunctionalRequirements.securityReviewRequired,
      riskOwnerSignoff: data.nonFunctionalRequirements.riskOwnerSignoff,
    },
    operabilityConstraints: {
      productionDeadline: data.operabilityConstraints.productionDeadline,
      pilotDurationDays: Number(data.operabilityConstraints.pilotDurationDays) || 0,
      scopeEnforcementMechanism: data.operabilityConstraints.scopeEnforcementMechanism,
      scopeCreepResponsePlan: data.operabilityConstraints.scopeCreepResponsePlan,
      operabilityOwner: data.operabilityConstraints.operabilityOwner,
      fallbackPlan: data.operabilityConstraints.fallbackPlan,
    },
    successMetrics: data.successMetrics.filter((m) => m.metric.trim()),
    hypotheses: data.hypotheses,
    outOfScope: data.outOfScope.filter((s) => s.trim()),
    dependencies: data.dependencies.filter((d) => d.trim()),
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

// ── Gate status helpers ───────────────────────────────────────────────────────

type GateStatus = "not_started" | "in_progress" | "valid" | "error";

function gateHasContent(key: keyof GateCoverage, data: PRDFormData): boolean {
  switch (key) {
    case "gate1_context":
      return (
        data.problemStatement.length > 0 ||
        data.evidenceSignals.some((s) => s.description || s.source) ||
        data.targetUser.segment.length > 0
      );
    case "gate2_evals":
      return data.syntheticEval.groundednessScore !== "" || data.syntheticEval.evalToolUsed !== "";
    case "gate3_tco":
      return data.tcoAnalysis.buildCostEstimate !== "" || data.tcoAnalysis.roiMoat !== "";
    case "gate4_nfr":
      return (
        data.nonFunctionalRequirements.dataResidency !== "" ||
        data.nonFunctionalRequirements.piiHandling !== "" ||
        data.nonFunctionalRequirements.complianceFrameworks.length > 0
      );
    case "gate5_operability":
      return (
        data.operabilityConstraints.productionDeadline !== "" ||
        data.operabilityConstraints.fallbackPlan !== ""
      );
    case "gate6_metrics":
      return (
        data.successMetrics.some((m) => m.metric !== "") ||
        data.outOfScope.some((s) => s !== "")
      );
  }
}

function getGateStatus(
  key: keyof GateCoverage,
  data: PRDFormData,
  validation: ValidationResult | null
): GateStatus {
  const hasContent = gateHasContent(key, data);
  if (!hasContent) return "not_started";
  if (!validation) return "in_progress";
  return validation.gateCoverage[key] ? "valid" : "error";
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function FieldError({ errors, field }: { errors: ValidationError[]; field: string }) {
  const relevant = errors.filter(
    (e) => e.field === field || e.field.startsWith(field + ".") || e.field.startsWith(field + "[")
  );
  if (!relevant.length) return null;
  return (
    <div className="mt-1.5 space-y-0.5">
      {relevant.map((e, i) => (
        <p key={i} className={cn("text-xs", e.severity === "hard" ? "text-destructive" : "text-amber-600")}>
          {e.severity === "hard" ? "✕ " : "⚠ "}
          {e.message}
        </p>
      ))}
    </div>
  );
}

function FL({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <Label className="text-sm font-medium">
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </Label>
  );
}

function SecHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
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

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0",
        checked ? "bg-primary" : "bg-muted"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-6" : "translate-x-1"
        )}
      />
      <span className="sr-only">{label}</span>
    </button>
  );
}

// ── Gate Stepper ──────────────────────────────────────────────────────────────

function GateStepper({
  data,
  validation,
  activeIndex,
  onSelect,
}: {
  data: PRDFormData;
  validation: ValidationResult | null;
  activeIndex: number;
  onSelect: (i: number) => void;
}) {
  const allGreen =
    validation !== null && Object.values(validation.gateCoverage).every(Boolean);

  const STATUS_DOT: Record<GateStatus, string> = {
    not_started: "bg-muted-foreground/30",
    in_progress: "bg-amber-400",
    valid: "bg-green-500",
    error: "bg-destructive",
  };
  const STATUS_TEXT: Record<GateStatus, string> = {
    not_started: "text-muted-foreground",
    in_progress: "text-amber-700",
    valid: "text-green-700",
    error: "text-destructive",
  };

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4 px-3">
        6 Gates
      </p>
      <nav className="space-y-0.5">
        {GATE_DEFS.map((gate, i) => {
          const status = getGateStatus(gate.key, data, validation);
          const isActive = i === activeIndex;
          return (
            <button
              key={gate.key}
              type="button"
              onClick={() => onSelect(i)}
              className={cn(
                "w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
                isActive ? "bg-accent" : "hover:bg-accent/50"
              )}
            >
              <div className="mt-1.5 shrink-0 flex flex-col items-center gap-1">
                <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", STATUS_DOT[status])} />
                {i < GATE_DEFS.length - 1 && <div className="w-px h-5 bg-border" />}
              </div>
              <div className="min-w-0">
                <p className={cn("text-sm font-medium leading-tight", isActive ? "text-foreground" : STATUS_TEXT[status])}>
                  G{i + 1} · {gate.label}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{gate.sub}</p>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Completeness */}
      {validation && (
        <div className="mt-4 mx-3 px-3 py-2 rounded-lg bg-muted/50">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Completeness</p>
          <p className={cn(
            "text-2xl font-bold tabular-nums mt-0.5",
            validation.completenessScore >= 80
              ? "text-green-600"
              : validation.completenessScore >= 60
              ? "text-amber-600"
              : "text-destructive"
          )}>
            {validation.completenessScore}
            <span className="text-sm font-normal text-muted-foreground ml-1">/ 100</span>
          </p>
        </div>
      )}

      {allGreen && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200">
          <p className="text-xs font-medium text-green-700">✓ All gates passing</p>
        </div>
      )}
    </div>
  );
}

// ── Gate 1: Context Engineering ───────────────────────────────────────────────

function Gate1Form({
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
    <div className="space-y-8">
      {/* Title (lives here since it's top-level context) */}
      <div className="space-y-1.5">
        <FL required>PRD Title</FL>
        <Input
          value={data.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="e.g., Dashboard Preset Saves for SMB Finance Managers"
        />
        <p className="text-xs text-muted-foreground">Min 10 chars — be specific.</p>
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
        />
        <p className="text-xs text-muted-foreground flex items-center justify-between">
          <span>Min 100 chars. Include evidence, scope, and frequency.</span>
          <span className={cn(
            "font-mono tabular-nums",
            data.problemStatement.length >= 100
              ? "text-green-600"
              : data.problemStatement.length >= 50
              ? "text-amber-600"
              : "text-muted-foreground"
          )}>
            {data.problemStatement.length} / 100
          </span>
        </p>
        <FieldError errors={errors} field="problemStatement" />
      </div>

      {/* Evidence Signals */}
      <div className="space-y-4">
        <SecHead title="Evidence Signals" sub="At least 2 required. At least one must be quantified." />
        {data.evidenceSignals.map((sig, i) => (
          <Card key={i} className="relative border-dashed">
            {data.evidenceSignals.length > 2 && (
              <div className="absolute top-3 right-3">
                <RemoveBtn
                  onClick={() => set({ evidenceSignals: data.evidenceSignals.filter((_, idx) => idx !== i) })}
                />
              </div>
            )}
            <CardContent className="pt-4 space-y-3">
              <div className="space-y-1">
                <FL required>Signal Type</FL>
                <div className="flex flex-wrap gap-1.5">
                  {(["user_research", "support_tickets", "usage_data", "competitive", "customer_quote"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        const next = [...data.evidenceSignals];
                        next[i] = { ...next[i], signalType: t };
                        set({ evidenceSignals: next });
                      }}
                      className={cn(
                        "px-2.5 py-1 rounded text-xs font-medium border transition-colors",
                        sig.signalType === t
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border text-muted-foreground hover:bg-accent"
                      )}
                    >
                      {t.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <FL required>Description</FL>
                <Textarea
                  value={sig.description}
                  onChange={(e) => {
                    const next = [...data.evidenceSignals];
                    next[i] = { ...next[i], description: e.target.value };
                    set({ evidenceSignals: next });
                  }}
                  placeholder="What does this signal show and why is it relevant?"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <FL required>Source</FL>
                  <Input
                    value={sig.source}
                    onChange={(e) => {
                      const next = [...data.evidenceSignals];
                      next[i] = { ...next[i], source: e.target.value };
                      set({ evidenceSignals: next });
                    }}
                    placeholder="e.g., UserTesting Jan 2026"
                  />
                </div>
                <div className="space-y-1">
                  <FL>Quantified Impact</FL>
                  <Input
                    value={sig.quantifiedImpact}
                    onChange={(e) => {
                      const next = [...data.evidenceSignals];
                      next[i] = { ...next[i], quantifiedImpact: e.target.value };
                      set({ evidenceSignals: next });
                    }}
                    placeholder="e.g., 42% of users"
                  />
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
              evidenceSignals: [
                ...data.evidenceSignals,
                { signalType: "user_research", description: "", source: "", quantifiedImpact: "" },
              ],
            })
          }
        >
          + Add signal
        </Button>
        <FieldError errors={errors} field="evidenceSignals" />
      </div>

      {/* Target User */}
      <div className="space-y-5">
        <SecHead title="Target User" sub="Who exactly is affected and what do they need?" />
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
                    onClick={() => setTU({ painPoints: data.targetUser.painPoints.filter((_, idx) => idx !== i) })}
                  />
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTU({ painPoints: [...data.targetUser.painPoints, ""] })}
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
    </div>
  );
}

// ── Gate 2: Synthetic Evals ───────────────────────────────────────────────────

function Gate2Form({
  data,
  errors,
  onChange,
}: {
  data: PRDFormData;
  errors: ValidationError[];
  onChange: (d: PRDFormData) => void;
}) {
  const ev = data.syntheticEval;
  const setEv = (patch: Partial<SyntheticEvalDraft>) =>
    onChange({ ...data, syntheticEval: { ...ev, ...patch } });

  const gs = Number(ev.groundednessScore);
  const hr = Number(ev.hallucinationRate);
  const gsOk = ev.groundednessScore !== "" && gs >= 90;
  const gsWarn = ev.groundednessScore !== "" && gs < 90;
  const hrOk = ev.hallucinationRate !== "" && hr <= 5;
  const hrWarn = ev.hallucinationRate !== "" && hr > 5;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <FL required>Groundedness Score (%)</FL>
          <div className="relative">
            <Input
              type="number"
              min={0}
              max={100}
              value={ev.groundednessScore}
              onChange={(e) => setEv({ groundednessScore: e.target.value })}
              placeholder="e.g., 93"
              className={cn(
                "pr-16",
                gsWarn && "border-destructive focus-visible:ring-destructive",
                gsOk && "border-green-500 focus-visible:ring-green-500"
              )}
            />
            {(gsOk || gsWarn) && (
              <span className={cn(
                "absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold",
                gsOk ? "text-green-600" : "text-destructive"
              )}>
                {gsOk ? "✓ ≥90" : "✕ <90"}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Must be ≥ 90% to pass.</p>
          <FieldError errors={errors} field="syntheticEval.groundednessScore" />
        </div>

        <div className="space-y-1.5">
          <FL required>Hallucination Rate (%)</FL>
          <div className="relative">
            <Input
              type="number"
              min={0}
              max={100}
              value={ev.hallucinationRate}
              onChange={(e) => setEv({ hallucinationRate: e.target.value })}
              placeholder="e.g., 3"
              className={cn(
                "pr-16",
                hrWarn && "border-destructive focus-visible:ring-destructive",
                hrOk && "border-green-500 focus-visible:ring-green-500"
              )}
            />
            {(hrOk || hrWarn) && (
              <span className={cn(
                "absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold",
                hrOk ? "text-green-600" : "text-destructive"
              )}>
                {hrOk ? "✓ ≤5" : "✕ >5"}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Must be ≤ 5% to pass.</p>
          <FieldError errors={errors} field="syntheticEval.hallucinationRate" />
        </div>
      </div>

      <div className="space-y-1.5">
        <FL required>Eval Dataset Description</FL>
        <Textarea
          value={ev.evalDatasetDescription}
          onChange={(e) => setEv({ evalDatasetDescription: e.target.value })}
          placeholder="Describe size, source, and diversity of the evaluation dataset."
          rows={3}
        />
        <FieldError errors={errors} field="syntheticEval.evalDatasetDescription" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <FL required>Eval Tool Used</FL>
          <Input
            value={ev.evalToolUsed}
            onChange={(e) => setEv({ evalToolUsed: e.target.value })}
            placeholder="e.g., PromptFoo, Braintrust, custom"
          />
          <FieldError errors={errors} field="syntheticEval.evalToolUsed" />
        </div>

        <div className="space-y-1.5">
          <FL required>Eval Run Date</FL>
          <Input
            type="date"
            value={ev.evalRunDate}
            onChange={(e) => setEv({ evalRunDate: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">Must be within last 90 days.</p>
          <FieldError errors={errors} field="syntheticEval.evalRunDate" />
        </div>
      </div>

      <div>
        <label className="flex items-start gap-3 cursor-pointer group">
          <div className={cn(
            "mt-0.5 w-5 h-5 shrink-0 rounded border-2 flex items-center justify-center transition-colors",
            ev.passedEvalGate
              ? "bg-primary border-primary"
              : "border-muted-foreground group-hover:border-primary"
          )}>
            {ev.passedEvalGate && <span className="text-primary-foreground text-xs font-bold leading-none">✓</span>}
            <input
              type="checkbox"
              className="sr-only"
              checked={ev.passedEvalGate}
              onChange={(e) => setEv({ passedEvalGate: e.target.checked })}
            />
          </div>
          <div>
            <p className="text-sm font-medium">I confirm this eval run meets the quality bar</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              This must be explicitly checked — it cannot be inferred from scores alone.
            </p>
          </div>
        </label>
        <FieldError errors={errors} field="syntheticEval.passedEvalGate" />
      </div>
    </div>
  );
}

// ── Gate 3: TCO & ROI Moat ────────────────────────────────────────────────────

function Gate3Form({
  data,
  errors,
  onChange,
}: {
  data: PRDFormData;
  errors: ValidationError[];
  onChange: (d: PRDFormData) => void;
}) {
  const tco = data.tcoAnalysis;
  const setTCO = (patch: Partial<TCOAnalysisDraft>) =>
    onChange({ ...data, tcoAnalysis: { ...tco, ...patch } });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <FL required>Build Cost Estimate</FL>
          <Input
            value={tco.buildCostEstimate}
            onChange={(e) => setTCO({ buildCostEstimate: e.target.value })}
            placeholder="e.g., $180k"
          />
          <FieldError errors={errors} field="tcoAnalysis.buildCostEstimate" />
        </div>
        <div className="space-y-1.5">
          <FL required>Buy Cost Estimate</FL>
          <Input
            value={tco.buyCostEstimate}
            onChange={(e) => setTCO({ buyCostEstimate: e.target.value })}
            placeholder="e.g., $60k/yr"
          />
          <FieldError errors={errors} field="tcoAnalysis.buyCostEstimate" />
        </div>
        <div className="space-y-1.5">
          <FL required>3-Year TCO</FL>
          <Input
            value={tco.threeYearTCO}
            onChange={(e) => setTCO({ threeYearTCO: e.target.value })}
            placeholder="e.g., $280k total"
          />
          <FieldError errors={errors} field="tcoAnalysis.threeYearTCO" />
        </div>
      </div>

      <div className="space-y-1.5">
        <FL required>Build vs Buy Decision</FL>
        <div className="flex gap-2">
          {(["build", "buy", "hybrid"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setTCO({ buildVsBuyDecision: opt })}
              className={cn(
                "px-4 py-2 rounded text-sm font-semibold border transition-colors capitalize",
                tco.buildVsBuyDecision === opt
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {opt}
            </button>
          ))}
        </div>
        <FieldError errors={errors} field="tcoAnalysis.buildVsBuyDecision" />
      </div>

      <div className="space-y-1.5">
        <FL required>ROI Moat</FL>
        <Textarea
          value={tco.roiMoat}
          onChange={(e) => setTCO({ roiMoat: e.target.value })}
          placeholder="Why does building this create defensible value that a vendor cannot replicate? Be specific about the strategic advantage."
          rows={4}
        />
        <p className="text-xs text-muted-foreground flex justify-between">
          <span>Min 50 chars — explain the strategic advantage.</span>
          <span className={cn("font-mono tabular-nums", tco.roiMoat.length >= 50 ? "text-green-600" : "text-muted-foreground")}>
            {tco.roiMoat.length} / 50
          </span>
        </p>
        <FieldError errors={errors} field="tcoAnalysis.roiMoat" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <FL required>Break-Even Timeline</FL>
          <Input
            value={tco.breakEvenTimeline}
            onChange={(e) => setTCO({ breakEvenTimeline: e.target.value })}
            placeholder="e.g., 18 months"
          />
          <FieldError errors={errors} field="tcoAnalysis.breakEvenTimeline" />
        </div>
      </div>

      <div className="space-y-1.5">
        <FL required>Build vs Buy Justification</FL>
        <Textarea
          value={tco.buildVsBuyJustification}
          onChange={(e) => setTCO({ buildVsBuyJustification: e.target.value })}
          placeholder="Why was this path chosen over the alternatives? Include what was ruled out and why."
          rows={3}
        />
        <p className="text-xs text-muted-foreground flex justify-between">
          <span>Min 50 chars.</span>
          <span className={cn("font-mono tabular-nums", tco.buildVsBuyJustification.length >= 50 ? "text-green-600" : "text-muted-foreground")}>
            {tco.buildVsBuyJustification.length} / 50
          </span>
        </p>
        <FieldError errors={errors} field="tcoAnalysis.buildVsBuyJustification" />
      </div>
    </div>
  );
}

// ── Gate 4: Non-Functional Requirements ──────────────────────────────────────

function Gate4Form({
  data,
  errors,
  onChange,
}: {
  data: PRDFormData;
  errors: ValidationError[];
  onChange: (d: PRDFormData) => void;
}) {
  const [cfInput, setCfInput] = React.useState("");
  const nfr = data.nonFunctionalRequirements;
  const setNFR = (patch: Partial<NFRDraft>) =>
    onChange({ ...data, nonFunctionalRequirements: { ...nfr, ...patch } });

  function addFramework() {
    const val = cfInput.trim();
    if (val && !nfr.complianceFrameworks.includes(val)) {
      setNFR({ complianceFrameworks: [...nfr.complianceFrameworks, val] });
    }
    setCfInput("");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <FL required>Data Residency</FL>
        <Textarea
          value={nfr.dataResidency}
          onChange={(e) => setNFR({ dataResidency: e.target.value })}
          placeholder="Which regions, cloud providers, and cross-border transfer restrictions apply?"
          rows={3}
        />
        <FieldError errors={errors} field="nonFunctionalRequirements.dataResidency" />
      </div>

      <div className="space-y-2">
        <FL required>Compliance Frameworks</FL>
        <div className="flex gap-2">
          <Input
            value={cfInput}
            onChange={(e) => setCfInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addFramework();
              }
            }}
            placeholder="e.g., GDPR, SOC 2, HIPAA"
          />
          <Button type="button" variant="outline" size="sm" onClick={addFramework}>
            Add
          </Button>
        </div>
        {nfr.complianceFrameworks.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {nfr.complianceFrameworks.map((f, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent rounded text-xs font-medium"
              >
                {f}
                <button
                  type="button"
                  onClick={() => setNFR({ complianceFrameworks: nfr.complianceFrameworks.filter((_, idx) => idx !== i) })}
                  className="text-muted-foreground hover:text-foreground ml-0.5"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <FieldError errors={errors} field="nonFunctionalRequirements.complianceFrameworks" />
      </div>

      <div className="space-y-1.5">
        <FL required>PII Handling</FL>
        <Textarea
          value={nfr.piiHandling}
          onChange={(e) => setNFR({ piiHandling: e.target.value })}
          placeholder="How is PII collected, stored, accessed, retained, and deleted?"
          rows={3}
        />
        <FieldError errors={errors} field="nonFunctionalRequirements.piiHandling" />
      </div>

      <div className="space-y-2">
        <FL required>Explainability Requirement</FL>
        <div className="grid grid-cols-2 gap-2">
          {(["none", "audit_log", "decision_rationale", "full_trace"] as const).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setNFR({ explainabilityRequirement: level })}
              className={cn(
                "px-3 py-2 rounded-lg border text-sm text-left transition-colors",
                nfr.explainabilityRequirement === level
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:bg-accent"
              )}
            >
              <p className="font-medium capitalize">{level.replace(/_/g, " ")}</p>
            </button>
          ))}
        </div>
        <FieldError errors={errors} field="nonFunctionalRequirements.explainabilityRequirement" />
      </div>

      <div className="space-y-1.5">
        <FL required>Explainability Justification</FL>
        <Textarea
          value={nfr.explainabilityJustification}
          onChange={(e) => setNFR({ explainabilityJustification: e.target.value })}
          placeholder="Why is this explainability level appropriate for this context?"
          rows={2}
        />
        <FieldError errors={errors} field="nonFunctionalRequirements.explainabilityJustification" />
      </div>

      <div className="flex items-center justify-between py-3 px-4 rounded-lg border">
        <div>
          <p className="text-sm font-medium">Security Review Required</p>
          <p className="text-xs text-muted-foreground mt-0.5">Does this feature need a formal security review before launch?</p>
        </div>
        <Toggle
          checked={nfr.securityReviewRequired}
          onChange={(v) => setNFR({ securityReviewRequired: v })}
          label="Security review required"
        />
      </div>

      <div className="space-y-1.5">
        <FL required>Risk Owner Sign-off</FL>
        <Input
          value={nfr.riskOwnerSignoff}
          onChange={(e) => setNFR({ riskOwnerSignoff: e.target.value })}
          placeholder="Name or role of the accountable risk owner"
        />
        <FieldError errors={errors} field="nonFunctionalRequirements.riskOwnerSignoff" />
      </div>
    </div>
  );
}

// ── Gate 5: Operability Constraints ──────────────────────────────────────────

function Gate5Form({
  data,
  errors,
  onChange,
}: {
  data: PRDFormData;
  errors: ValidationError[];
  onChange: (d: PRDFormData) => void;
}) {
  const ops = data.operabilityConstraints;
  const setOps = (patch: Partial<OperabilityDraft>) =>
    onChange({ ...data, operabilityConstraints: { ...ops, ...patch } });

  const pilotDays = Number(ops.pilotDurationDays);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <FL required>Production Deadline</FL>
          <Input
            type="date"
            value={ops.productionDeadline}
            onChange={(e) => setOps({ productionDeadline: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">Must be a future date.</p>
          <FieldError errors={errors} field="operabilityConstraints.productionDeadline" />
        </div>

        <div className="space-y-1.5">
          <FL required>Pilot Duration (days)</FL>
          <Input
            type="number"
            min={1}
            max={365}
            value={ops.pilotDurationDays}
            onChange={(e) => setOps({ pilotDurationDays: e.target.value })}
            placeholder="e.g., 30"
            className={cn(pilotDays > 90 && ops.pilotDurationDays !== "" && "border-amber-500")}
          />
          {pilotDays > 90 && ops.pilotDurationDays !== "" && (
            <p className="text-xs text-amber-600">⚠ Exceeds 90-day cap — escalation required.</p>
          )}
          <FieldError errors={errors} field="operabilityConstraints.pilotDurationDays" />
        </div>
      </div>

      <div className="space-y-1.5">
        <FL required>Scope Enforcement Mechanism</FL>
        <Textarea
          value={ops.scopeEnforcementMechanism}
          onChange={(e) => setOps({ scopeEnforcementMechanism: e.target.value })}
          placeholder="e.g., Feature flags controlled by PM, weekly scope review with stakeholder sign-off required to expand."
          rows={3}
        />
        <FieldError errors={errors} field="operabilityConstraints.scopeEnforcementMechanism" />
      </div>

      <div className="space-y-1.5">
        <FL required>Scope Creep Response Plan</FL>
        <Textarea
          value={ops.scopeCreepResponsePlan}
          onChange={(e) => setOps({ scopeCreepResponsePlan: e.target.value })}
          placeholder="What happens when scope creep is detected mid-pilot?"
          rows={3}
        />
        <FieldError errors={errors} field="operabilityConstraints.scopeCreepResponsePlan" />
      </div>

      <div className="space-y-1.5">
        <FL required>Operability Owner</FL>
        <Input
          value={ops.operabilityOwner}
          onChange={(e) => setOps({ operabilityOwner: e.target.value })}
          placeholder="Name or role accountable during rollout"
        />
        <FieldError errors={errors} field="operabilityConstraints.operabilityOwner" />
      </div>

      <div className="space-y-1.5">
        <FL required>Fallback Plan</FL>
        <Textarea
          value={ops.fallbackPlan}
          onChange={(e) => setOps({ fallbackPlan: e.target.value })}
          placeholder="How is this feature disabled or rolled back at 2am? Be specific — describe the exact steps."
          rows={3}
        />
        <FieldError errors={errors} field="operabilityConstraints.fallbackPlan" />
      </div>
    </div>
  );
}

// ── Gate 6: Success Metrics ───────────────────────────────────────────────────

function Gate6Form({
  data,
  errors,
  onChange,
}: {
  data: PRDFormData;
  errors: ValidationError[];
  onChange: (d: PRDFormData) => void;
}) {
  const set = (patch: Partial<PRDFormData>) => onChange({ ...data, ...patch });

  return (
    <div className="space-y-8">
      {/* Success Metrics */}
      <div className="space-y-4">
        <SecHead title="Success Metrics" sub="At least 2 required. Each must be observable in production." />
        {data.successMetrics.map((m, i) => (
          <Card key={i} className="relative border-dashed">
            {data.successMetrics.length > 1 && (
              <div className="absolute top-3 right-3">
                <RemoveBtn
                  onClick={() => set({ successMetrics: data.successMetrics.filter((_, idx) => idx !== i) })}
                />
              </div>
            )}
            <CardContent className="pt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
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
                <div className="space-y-1">
                  <FL required>Measurement Method</FL>
                  <Input
                    value={m.measurementMethod}
                    onChange={(e) => {
                      const next = [...data.successMetrics];
                      next[i] = { ...next[i], measurementMethod: e.target.value };
                      set({ successMetrics: next });
                    }}
                    placeholder="e.g., Mixpanel → dashboard_session_end"
                  />
                </div>
                <div className="space-y-1">
                  <FL required>Monitoring Tool</FL>
                  <Input
                    value={m.monitoringTool}
                    onChange={(e) => {
                      const next = [...data.successMetrics];
                      next[i] = { ...next[i], monitoringTool: e.target.value };
                      set({ successMetrics: next });
                    }}
                    placeholder="e.g., Datadog, Grafana"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <FL required>Degradation Threshold</FL>
                  <Input
                    value={m.degradationThreshold}
                    onChange={(e) => {
                      const next = [...data.successMetrics];
                      next[i] = { ...next[i], degradationThreshold: e.target.value };
                      set({ successMetrics: next });
                    }}
                    placeholder="e.g., below 90% for 5 consecutive minutes"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <FL required>Degradation Response Plan</FL>
                  <Textarea
                    value={m.degradationResponsePlan}
                    onChange={(e) => {
                      const next = [...data.successMetrics];
                      next[i] = { ...next[i], degradationResponsePlan: e.target.value };
                      set({ successMetrics: next });
                    }}
                    placeholder="What does on-call do when this threshold is crossed?"
                    rows={2}
                  />
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
              successMetrics: [
                ...data.successMetrics,
                { metric: "", baseline: "", target: "", measurementMethod: "", monitoringTool: "", degradationThreshold: "", degradationResponsePlan: "" },
              ],
            })
          }
        >
          + Add metric
        </Button>
        <FieldError errors={errors} field="successMetrics" />
      </div>

      {/* Hypotheses */}
      <div className="space-y-4">
        <SecHead title="Hypotheses" sub="What assumptions must be true for this PRD to deliver value?" />
        {data.hypotheses.map((h, i) => (
          <Card key={i} className="relative border-dashed">
            {data.hypotheses.length > 1 && (
              <div className="absolute top-3 right-3">
                <RemoveBtn
                  onClick={() => set({ hypotheses: data.hypotheses.filter((_, idx) => idx !== i) })}
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
            set({ hypotheses: [...data.hypotheses, { assumption: "", validationMethod: "", riskLevel: "medium" }] })
          }
        >
          + Add hypothesis
        </Button>
      </div>

      {/* Out of Scope */}
      <div className="space-y-3">
        <SecHead title="Out of Scope" sub="What does this PRD explicitly NOT cover? Min 2 required." />
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
                  onClick={() => set({ outOfScope: data.outOfScope.filter((_, idx) => idx !== i) })}
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

      {/* Dependencies */}
      <div className="space-y-3">
        <SecHead title="Dependencies" sub="External teams, systems, or decisions this work depends on." />
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
                placeholder="e.g., Auth team API v2"
              />
              <RemoveBtn
                onClick={() => set({ dependencies: data.dependencies.filter((_, idx) => idx !== i) })}
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
      <div className="space-y-1.5">
        <FL required>Objective</FL>
        <Textarea
          value={data.objective}
          onChange={(e) => set({ objective: e.target.value })}
          placeholder="What does 'winning' look like this quarter?"
          rows={3}
        />
        <FieldError errors={errors} field="objective" />
      </div>

      <div className="space-y-4">
        <SecHead title="Key Results" sub="2–5 measurable outcomes." />
        {data.keyResults.map((kr, i) => (
          <Card key={i} className="relative border-dashed">
            {data.keyResults.length > 2 && (
              <div className="absolute top-3 right-3">
                <RemoveBtn
                  onClick={() => set({ keyResults: data.keyResults.filter((_, idx) => idx !== i) })}
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
              set({ keyResults: [...data.keyResults, { kr: "", metric: "", currentValue: "0", targetValue: "0", dueDate: "" }] })
            }
          >
            + Add key result
          </Button>
        )}
        <FieldError errors={errors} field="keyResults" />
      </div>

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
                  onClick={() => set({ timeframe: { ...data.timeframe, quarter: q } })}
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
              onChange={(e) => set({ timeframe: { ...data.timeframe, year: e.target.value } })}
              className="w-24"
            />
          </div>
        </div>
      </div>

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

// ── Brief Form ────────────────────────────────────────────────────────────────

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
      <div className="space-y-1.5">
        <FL required>Opportunity</FL>
        <Textarea
          value={data.opportunity}
          onChange={(e) => set({ opportunity: e.target.value })}
          placeholder="What user pain or market gap are you exploring?"
          rows={4}
        />
        <FieldError errors={errors} field="opportunity" />
      </div>

      <div className="space-y-1.5">
        <FL required>Proposed Solution</FL>
        <Textarea
          value={data.proposedSolution}
          onChange={(e) => set({ proposedSolution: e.target.value })}
          placeholder="By doing X, we believe Y will happen."
          rows={4}
        />
        <FieldError errors={errors} field="proposedSolution" />
      </div>

      <div className="space-y-3">
        <SecHead title="Linked OKRs" sub="At least 1 required to pass hard gates." />
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
                onClick={() => set({ linkedOKRs: data.linkedOKRs.filter((_, idx) => idx !== i) })}
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

      <div className="space-y-1.5">
        <FL required>Estimated Impact</FL>
        <Textarea
          value={data.estimatedImpact}
          onChange={(e) => set({ estimatedImpact: e.target.value })}
          placeholder="Quantify if possible — e.g., 'could reduce churn by ~5%'."
          rows={3}
        />
        <FieldError errors={errors} field="estimatedImpact" />
      </div>

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
                {level === "low" ? "Needs validation" : level === "medium" ? "Some evidence" : "Strong signal"}
              </div>
            </button>
          ))}
        </div>
        <FieldError errors={errors} field="confidence" />
      </div>
    </div>
  );
}

// ── Quality Panel (OKR / Brief) ───────────────────────────────────────────────

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
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
            Completeness
            {isValidating && <span className="text-xs font-normal animate-pulse">Checking…</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {!validation ? (
            <p className="text-xs text-muted-foreground">Start filling the form to see your score.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-end gap-2">
                <span className={cn(
                  "text-4xl font-bold tabular-nums leading-none",
                  score >= 80 ? "text-green-600" : score >= 60 ? "text-amber-600" : "text-destructive"
                )}>
                  {score}
                </span>
                <span className="text-muted-foreground text-sm mb-0.5">/ 100</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    score >= 80 ? "bg-green-500" : score >= 60 ? "bg-amber-500" : "bg-destructive"
                  )}
                  style={{ width: `${score}%` }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
            <p className="text-xs text-muted-foreground">Fill in the form to check gates.</p>
          ) : hardErrors.length === 0 ? (
            <div className="flex items-center gap-2 text-green-600 text-xs font-medium">
              <span>✓</span><span>All schema requirements met</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              {hardErrors.slice(0, 8).map((e, i) => (
                <div key={i} className="text-xs space-y-0.5">
                  <span className="font-mono text-[10px] text-muted-foreground">{e.field}</span>
                  <p className="text-destructive pl-0">{e.message}</p>
                </div>
              ))}
              {hardErrors.length > 8 && (
                <p className="text-xs text-muted-foreground">+{hardErrors.length - 8} more</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {softWarnings.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Quality Hints
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {softWarnings.map((e, i) => (
              <p key={i} className="text-xs text-amber-700">⚠ {e.message}</p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Progress Overlay ──────────────────────────────────────────────────────────

type SubmitPhase = "idle" | "validating" | "gates" | "adversarial" | "drift" | "complete" | "error";

const STEPS: { phase: SubmitPhase; label: string }[] = [
  { phase: "validating", label: "Running schema validation..." },
  { phase: "gates", label: "Applying quality gates..." },
  { phase: "adversarial", label: "Running adversarial review..." },
  { phase: "drift", label: "Checking drift..." },
  { phase: "complete", label: "Complete" },
];

const PHASE_IDX: Record<SubmitPhase, number> = {
  idle: -1, validating: 0, gates: 1, adversarial: 2, drift: 3, complete: 4, error: -1,
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
                className={cn("flex items-center gap-3 text-sm transition-opacity duration-300", !done && !active && "opacity-35")}
              >
                <span className="w-5 h-5 shrink-0 flex items-center justify-center">
                  {done ? (
                    <span className="text-green-600 text-base">✓</span>
                  ) : active ? (
                    <span className="block w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  ) : (
                    <span className="block w-2 h-2 rounded-full bg-muted-foreground/30 mx-auto" />
                  )}
                </span>
                <span className={cn(done ? "text-muted-foreground line-through" : active ? "text-foreground font-medium" : "text-muted-foreground")}>
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

function ReviewResults({ report, onReset }: { report: ReviewReport; onReset: () => void }) {
  const rec = report.recommendation;
  const recStyles = {
    approve: "border-green-300 bg-green-50 text-green-800",
    revise: "border-amber-300 bg-amber-50 text-amber-800",
    reject: "border-red-300 bg-red-50 text-red-800",
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Review Complete</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {report.artifactName} · <span className="capitalize">{report.artifactType}</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onReset}>← Submit another</Button>
      </div>

      <div className={cn("rounded-xl border-2 px-6 py-5 flex items-center justify-between gap-4", recStyles)}>
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold">{recIcon}</span>
          <div>
            <div className="font-bold text-lg uppercase tracking-wide">{rec}</div>
            <div className="text-sm opacity-75 mt-0.5">{recLabel}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-4xl font-bold tabular-nums">{report.qualityScore}</div>
          <div className="text-xs opacity-60 mt-0.5">quality score</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hard Gates</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {report.hardGates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hard gates for this artifact type.</p>
            ) : (
              report.hardGates.map((g, i) => (
                <div key={i} className={cn("flex gap-2.5 text-xs p-2.5 rounded-lg", g.passed ? "bg-green-50" : "bg-red-50")}>
                  <span className={cn("shrink-0 mt-px font-bold", g.passed ? "text-green-600" : "text-red-600")}>
                    {g.passed ? "✓" : "✕"}
                  </span>
                  <div>
                    <p className="font-mono font-semibold">{g.gateName}</p>
                    <p className={g.passed ? "text-green-700" : "text-red-700"}>{g.reason}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quality Gates</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {report.softGates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No soft gates for this artifact type.</p>
            ) : (
              report.softGates.map((g, i) => (
                <div key={i} className={cn("flex gap-2.5 text-xs p-2.5 rounded-lg", g.passed ? "bg-green-50" : "bg-amber-50")}>
                  <span className={cn("shrink-0 mt-px", g.passed ? "text-green-600" : "text-amber-600")}>
                    {g.passed ? "✓" : "⚠"}
                  </span>
                  <div>
                    <p className="font-mono font-semibold">{g.gateName}</p>
                    <p className={g.passed ? "text-green-700" : "text-amber-700"}>{g.passed ? g.warning : g.suggestion}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
            Adversarial Review
            <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-semibold normal-case tracking-normal", riskStyles)}>
              {report.adversarialReview.overallRisk} risk
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-5">
          {report.adversarialReview.redFlags.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-destructive mb-2">Red Flags</p>
              <ul className="space-y-1.5">
                {report.adversarialReview.redFlags.map((flag, i) => (
                  <li key={i} className="flex gap-2 text-xs text-red-700"><span>🚩</span><span>{flag}</span></li>
                ))}
              </ul>
            </div>
          )}
          {report.adversarialReview.findings.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-2">Findings</p>
              <div className="space-y-2">
                {report.adversarialReview.findings.map((f, i) => (
                  <div
                    key={i}
                    className={cn(
                      "p-3 rounded-lg text-xs border-l-2",
                      f.severity === 3 ? "border-red-500 bg-red-50" : f.severity === 2 ? "border-amber-500 bg-amber-50" : "border-blue-400 bg-blue-50"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono font-semibold">{f.section}</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal">{f.findingType}</Badge>
                    </div>
                    <p>{f.description}</p>
                    <p className="text-muted-foreground mt-1.5 italic">Q: {f.suggestedQuestion}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {report.adversarialReview.strengthSignals.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-green-700 mb-2">Strengths</p>
              <ul className="space-y-1.5">
                {report.adversarialReview.strengthSignals.map((s, i) => (
                  <li key={i} className="flex gap-2 text-xs text-green-700"><span>✓</span><span>{s}</span></li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SubmitPage() {
  const [artifactType, setArtifactType] = useState<ArtifactType>("prd");
  const [prdData, setPrdData] = useState<PRDFormData>(defaultPRD);
  const [okrData, setOkrData] = useState<OKRFormData>(defaultOKR);
  const [briefData, setBriefData] = useState<BriefFormData>(defaultBrief);

  const [activeGate, setActiveGate] = useState(0);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>("idle");
  const [reviewReport, setReviewReport] = useState<ReviewReport | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Debounced validation ────────────────────────────────────────────────────

  const runValidation = useCallback(async (type: ArtifactType, content: unknown) => {
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
  }, []);

  const scheduleValidation = useCallback(
    (type: ArtifactType, content: unknown) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setIsValidating(true);
      debounceRef.current = setTimeout(() => runValidation(type, content), 500);
    },
    [runValidation]
  );

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
    setActiveGate(0);
    const content =
      type === "prd" ? serializePRD(prdData) : type === "okr" ? serializeOKR(okrData) : serializeBrief(briefData);
    scheduleValidation(type, content);
  }

  // ── Can submit ──────────────────────────────────────────────────────────────

  const allGatesGreen =
    artifactType === "prd"
      ? validation !== null && Object.values(validation.gateCoverage).every(Boolean)
      : validation?.valid === true;

  const canSubmit = allGatesGreen && submitPhase === "idle";

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitError(null);
    setSubmitPhase("validating");
    await new Promise((r) => setTimeout(r, 350));
    setSubmitPhase("gates");
    await new Promise((r) => setTimeout(r, 500));
    setSubmitPhase("adversarial");

    try {
      let report: ReviewReport;

      if (artifactType === "prd") {
        const content = { artifactType: "prd" as const, ...serializePRD(prdData) };
        const res = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? "Review pipeline failed");
        }
        report = await res.json();
      } else {
        const content = artifactType === "okr" ? serializeOKR(okrData) : serializeBrief(briefData);
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
            redFlags: val.errors.filter((e) => e.severity === "hard").map((e) => `${e.field}: ${e.message}`).slice(0, 3),
            strengthSignals: val.valid ? ["Schema validation passed", `Completeness score: ${val.completenessScore}%`] : [],
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
      sessionStorage.setItem("lastReviewReport", JSON.stringify(report));
      setReviewReport(report);
      setSubmitPhase("idle");
    } catch (err) {
      setSubmitPhase("idle");
      setSubmitError(err instanceof Error ? err.message : "An unexpected error occurred");
    }
  }

  // ── Render: results view ────────────────────────────────────────────────────

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

  // ── Render: form view ───────────────────────────────────────────────────────

  const validationErrors = validation?.errors ?? [];
  const hardErrors = validationErrors.filter((e) => e.severity === "hard");

  return (
    <main className="min-h-screen">
      <ProgressOverlay phase={submitPhase} />

      {/* Sticky header */}
      <div className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold leading-tight">Submit Artifact</h1>
            <p className="text-xs text-muted-foreground">Run quality gates and AI review before committing</p>
          </div>
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0">
            ← Home
          </a>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-5 py-8">
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
                <span className={cn("text-xs font-normal", artifactType === type ? "opacity-75" : "opacity-60")}>
                  {type === "prd" ? "Product Requirement" : type === "okr" ? "Objectives & Key Results" : "Discovery Brief"}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* PRD: stepper layout */}
        {artifactType === "prd" && (
          <form
            onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
          >
            <div className="grid grid-cols-[220px_1fr] gap-8 items-start">
              {/* Left: stepper (sticky) */}
              <div className="sticky top-[73px]">
                <GateStepper
                  data={prdData}
                  validation={validation}
                  activeIndex={activeGate}
                  onSelect={setActiveGate}
                />
                {isValidating && (
                  <p className="text-[10px] text-muted-foreground animate-pulse px-3 mt-3">Validating…</p>
                )}
              </div>

              {/* Right: active gate form */}
              <div>
                {/* Gate header */}
                <div className="mb-6">
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Gate {activeGate + 1} of 6
                  </p>
                  <h2 className="text-xl font-bold mt-1">{GATE_DEFS[activeGate].label}</h2>
                </div>

                {/* Gate content */}
                <div className="pb-6">
                  {activeGate === 0 && (
                    <Gate1Form data={prdData} errors={validationErrors} onChange={handlePRDChange} />
                  )}
                  {activeGate === 1 && (
                    <Gate2Form data={prdData} errors={validationErrors} onChange={handlePRDChange} />
                  )}
                  {activeGate === 2 && (
                    <Gate3Form data={prdData} errors={validationErrors} onChange={handlePRDChange} />
                  )}
                  {activeGate === 3 && (
                    <Gate4Form data={prdData} errors={validationErrors} onChange={handlePRDChange} />
                  )}
                  {activeGate === 4 && (
                    <Gate5Form data={prdData} errors={validationErrors} onChange={handlePRDChange} />
                  )}
                  {activeGate === 5 && (
                    <Gate6Form data={prdData} errors={validationErrors} onChange={handlePRDChange} />
                  )}
                </div>

                {/* Gate navigation */}
                <div className="flex items-center justify-between pt-6 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setActiveGate((g) => Math.max(0, g - 1))}
                    disabled={activeGate === 0}
                  >
                    ← Previous
                  </Button>

                  <div className="flex items-center gap-3">
                    {submitError && (
                      <p className="text-xs text-destructive max-w-xs">{submitError}</p>
                    )}
                    {canSubmit ? (
                      <p className="text-xs text-green-600 font-medium">✓ All gates passing — ready to submit</p>
                    ) : validation && hardErrors.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {hardErrors.length} error{hardErrors.length !== 1 ? "s" : ""} remaining
                      </p>
                    ) : null}
                    <Button type="submit" disabled={!canSubmit} size="lg">
                      {submitPhase !== "idle" ? (
                        <span className="flex items-center gap-2">
                          <span className="block w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                          Reviewing…
                        </span>
                      ) : (
                        "Run AI Review →"
                      )}
                    </Button>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setActiveGate((g) => Math.min(5, g + 1))}
                    disabled={activeGate === 5}
                  >
                    Next →
                  </Button>
                </div>
              </div>
            </div>
          </form>
        )}

        {/* OKR / Brief: original two-column layout */}
        {artifactType !== "prd" && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 items-start">
            <form
              onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
              className="space-y-8"
            >
              {artifactType === "okr" && (
                <OKRForm data={okrData} errors={validationErrors} onChange={handleOKRChange} />
              )}
              {artifactType === "brief" && (
                <BriefForm data={briefData} errors={validationErrors} onChange={handleBriefChange} />
              )}

              {submitError && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  <strong>Error:</strong> {submitError}
                </div>
              )}

              <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-3">
                <Button type="submit" size="lg" disabled={!canSubmit}>
                  {submitPhase !== "idle" ? (
                    <span className="flex items-center gap-2">
                      <span className="block w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                      Reviewing…
                    </span>
                  ) : (
                    "Run AI Review →"
                  )}
                </Button>
                {validation && canSubmit && (
                  <p className="text-xs text-green-600 font-medium">✓ Ready to submit</p>
                )}
              </div>
            </form>

            <div className="lg:sticky lg:top-[73px]">
              <QualityPanel validation={validation} isValidating={isValidating} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
