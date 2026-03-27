"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  FileText,
  ShieldCheck,
  GitBranch,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  ChevronRight,
  Activity,
  AlertTriangle,
  BarChart2,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DashboardStats {
  totalArtifacts: number;
  avgQualityScore: number;
  qualityScoreTrend: number;
  hardGatePassRate: number;
  driftIncidentsThisMonth: number;
}

interface TimelinePoint {
  index: number;
  date: string;
  artifactName: string;
  artifactType: string;
  qualityScore: number;
  recommendation: string;
  id: number;
}

interface GateBreakdownItem {
  gateName: string;
  passed: number;
  failed: number;
  total: number;
  passRate: number;
}

interface RecentReview {
  id: number;
  artifactId: string | null;
  artifactName: string;
  artifactType: string;
  timestamp: string;
  qualityScore: number;
  recommendation: string;
  blocked: boolean;
  driftVerdict: string | null;
  driftScore: number | null;
  gateStatuses: boolean[];
}

interface GateHealthItem {
  prefix: string;
  name: string;
  passed: number;
  failed: number;
  total: number;
  passRate: number;
  topFailureReason: string | null;
}

interface AiEraAuditAggregate {
  evalCredibility: { credible: number; questionable: number; missing: number };
  economicDefensibility: { strong: number; weak: number; missing: number };
  operabilityRealism: { realistic: number; optimistic: number; missing: number };
  complianceReadiness: { ready: number; gaps: number; missing: number };
}

interface FindingCount {
  findingType: string;
  count: number;
}

interface DriftHeatmapPoint {
  artifactLabel: string;
  date: string;
  driftScore: number;
  verdict: string;
}

interface DashboardData {
  stats: DashboardStats;
  timeline: TimelinePoint[];
  gateBreakdown: GateBreakdownItem[];
  gateHealthPanel: GateHealthItem[];
  recentReviews: RecentReview[];
  findingsAggregate: FindingCount[];
  driftHeatmap: DriftHeatmapPoint[];
  aiEraAuditAggregate: AiEraAuditAggregate;
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const ARTIFACT_COLOR: Record<string, string> = {
  prd: "#3b82f6",
  okr: "#22c55e",
  brief: "#eab308",
};

const FINDING_COLORS = ["#ef4444", "#f97316", "#eab308", "#3b82f6", "#8b5cf6"];

const FINDING_LABELS: Record<string, string> = {
  assumption: "Assumption",
  contradiction: "Contradiction",
  vanity_metric: "Vanity Metric",
  missing_evidence: "Missing Evidence",
  scope_risk: "Scope Risk",
};

const CHART_THEME = {
  grid: "#1e2533",
  axis: "#4b5563",
  tooltip: {
    contentStyle: {
      background: "#0d1117",
      border: "1px solid #30363d",
      borderRadius: 6,
      fontSize: 12,
      boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
    },
    labelStyle: { color: "#e6edf3", marginBottom: 4 },
    itemStyle: { color: "#8b949e", padding: "1px 0" },
  },
};

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-gradient-to-r from-[#161b22] to-[#1c2333]",
        className
      )}
    />
  );
}

// ── Section header ─────────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  label,
  sub,
  right,
}: {
  icon: React.ElementType;
  label: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md border border-[#30363d] bg-[#161b22]">
          <Icon size={13} className="text-[#8b949e]" />
        </div>
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest text-[#8b949e]">
            {label}
          </span>
          {sub && <p className="mt-0.5 text-xs text-[#484f58]">{sub}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

function Panel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-[#30363d] bg-[#0d1117] p-5",
        className
      )}
    >
      {children}
    </div>
  );
}

// ── Score badge ───────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80
      ? "border-emerald-800 bg-emerald-950/60 text-emerald-400"
      : score >= 60
      ? "border-yellow-800 bg-yellow-950/60 text-yellow-400"
      : "border-red-900 bg-red-950/60 text-red-400";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 font-mono text-xs font-bold tabular-nums",
        color
      )}
    >
      {score}
    </span>
  );
}

// ── Reco badge ────────────────────────────────────────────────────────────────

function RecoBadge({ value }: { value: string }) {
  const styles: Record<string, string> = {
    approve: "border-emerald-800 bg-emerald-950/60 text-emerald-400",
    revise: "border-yellow-800 bg-yellow-950/60 text-yellow-400",
    reject: "border-red-900 bg-red-950/60 text-red-400",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold capitalize",
        styles[value] ?? "border-[#30363d] bg-[#161b22] text-[#8b949e]"
      )}
    >
      {value}
    </span>
  );
}

// ── Drift badge ───────────────────────────────────────────────────────────────

function DriftBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 text-xs text-[#484f58]">
        —
      </span>
    );
  }
  const isDrift =
    verdict === "significant_drift" ||
    verdict === "misaligned" ||
    verdict === "minor_drift";
  const styles: Record<string, string> = {
    aligned: "border-emerald-800 bg-emerald-950/60 text-emerald-400",
    minor_drift: "border-yellow-800 bg-yellow-950/60 text-yellow-400",
    significant_drift: "border-orange-800 bg-orange-950/60 text-orange-400",
    misaligned: "border-red-900 bg-red-950/60 text-red-400",
  };
  const labels: Record<string, string> = {
    aligned: "Aligned",
    minor_drift: "Minor Drift",
    significant_drift: "Drift Detected",
    misaligned: "Misaligned",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium",
        styles[verdict] ?? "border-[#30363d] bg-[#161b22] text-[#8b949e]"
      )}
    >
      {isDrift && <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />}
      {labels[verdict] ?? verdict}
    </span>
  );
}

// ── Artifact type chip ────────────────────────────────────────────────────────

function TypeChip({ type }: { type: string }) {
  const color = ARTIFACT_COLOR[type] ?? "#8b949e";
  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider"
      style={{ background: color + "22", color }}
    >
      {type}
    </span>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[#21262d] text-center">
      <Activity size={20} className="text-[#30363d]" />
      <p className="max-w-xs text-xs text-[#484f58]">{message}</p>
    </div>
  );
}

// ── Gate label map ────────────────────────────────────────────────────────────

const GATE_PHASE_LABELS: Record<string, string> = {
  "Gate 1": "Gate 1: Context Engineering",
  "Gate 2": "Gate 2: Synthetic Evals",
  "Gate 3": "Gate 3: ROI Moat",
  "Gate 4": "Gate 4: NFR Compliance",
  "Gate 5": "Gate 5: Operability",
  "Gate 6": "Gate 6: Success Metrics",
};

// ── 1. Stat cards ─────────────────────────────────────────────────────────────

function StatCards({
  stats,
  loading,
}: {
  stats: DashboardStats | null;
  loading: boolean;
}) {
  const trend = stats?.qualityScoreTrend ?? 0;
  const TrendIcon =
    trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;
  const trendColor =
    trend > 0 ? "text-emerald-400" : trend < 0 ? "text-red-400" : "text-[#484f58]";

  const cards = [
    {
      key: "reviews",
      label: "Total Reviews",
      value: stats?.totalArtifacts ?? 0,
      sub: "artifacts submitted",
      icon: FileText,
      accent: "#3b82f6",
      valueColor: "text-[#e6edf3]",
    },
    {
      key: "score",
      label: "Avg Quality Score",
      value: stats?.avgQualityScore ?? 0,
      sub: (
        <span className={cn("flex items-center gap-1", trendColor)}>
          <TrendIcon size={11} />
          {trend !== 0
            ? `${trend > 0 ? "+" : ""}${trend} vs last 7d`
            : "No change vs last 7d"}
        </span>
      ),
      icon: Activity,
      accent:
        (stats?.avgQualityScore ?? 0) >= 80
          ? "#22c55e"
          : (stats?.avgQualityScore ?? 0) >= 60
          ? "#eab308"
          : "#ef4444",
      valueColor:
        (stats?.avgQualityScore ?? 0) >= 80
          ? "text-emerald-400"
          : (stats?.avgQualityScore ?? 0) >= 60
          ? "text-yellow-400"
          : "text-red-400",
    },
    {
      key: "gates",
      label: "Hard Gate Pass Rate",
      value: stats ? `${stats.hardGatePassRate}%` : "—",
      sub: "of all gate checks",
      icon: ShieldCheck,
      accent:
        (stats?.hardGatePassRate ?? 0) >= 70 ? "#22c55e" : "#ef4444",
      valueColor:
        (stats?.hardGatePassRate ?? 0) >= 70
          ? "text-emerald-400"
          : "text-red-400",
    },
    {
      key: "drift",
      label: "Drift Incidents",
      value: stats?.driftIncidentsThisMonth ?? 0,
      sub: "this month  ·  score > 40",
      icon: GitBranch,
      accent:
        (stats?.driftIncidentsThisMonth ?? 0) > 0 ? "#f97316" : "#22c55e",
      valueColor:
        (stats?.driftIncidentsThisMonth ?? 0) > 0
          ? "text-orange-400"
          : "text-emerald-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) =>
        loading ? (
          <div
            key={card.key}
            className="rounded-xl border border-[#30363d] bg-[#0d1117] p-5"
          >
            <Skeleton className="mb-3 h-3 w-20" />
            <Skeleton className="mb-2 h-9 w-14" />
            <Skeleton className="h-3 w-28" />
          </div>
        ) : (
          <div
            key={card.key}
            className="group relative overflow-hidden rounded-xl border border-[#30363d] bg-[#0d1117] p-5 transition-colors hover:border-[#484f58]"
          >
            {/* accent glow */}
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-60"
              style={{ background: `linear-gradient(90deg, transparent, ${card.accent}, transparent)` }}
            />
            <div className="mb-3 flex items-center gap-2">
              <card.icon size={13} style={{ color: card.accent }} />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[#484f58]">
                {card.label}
              </span>
            </div>
            <div
              className={cn(
                "mb-1 font-mono text-[32px] font-bold leading-none tabular-nums",
                card.valueColor
              )}
            >
              {card.value}
            </div>
            <div className="text-xs text-[#484f58]">{card.sub}</div>
          </div>
        )
      )}
    </div>
  );
}

// ── 2. Gate health panel ──────────────────────────────────────────────────────

function GateHealthPanel({
  data,
  loading,
}: {
  data: GateHealthItem[];
  loading: boolean;
}) {
  return (
    <Panel>
      <SectionHeader
        icon={ShieldCheck}
        label="Gate Health Panel"
        sub="Pass rate per gate across all reviews"
      />
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <EmptyState message="No gate data yet — submit a PRD to see gate health." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {data.map((gate) => {
            const isGreen = gate.passRate > 80;
            const isYellow = gate.passRate >= 50 && gate.passRate <= 80;
            const borderColor = isGreen
              ? "border-emerald-800"
              : isYellow
              ? "border-yellow-800"
              : "border-red-900";
            const bgColor = isGreen
              ? "bg-emerald-950/30"
              : isYellow
              ? "bg-yellow-950/30"
              : "bg-red-950/30";
            const rateColor = isGreen
              ? "text-emerald-400"
              : isYellow
              ? "text-yellow-400"
              : "text-red-400";
            const accentBg = isGreen
              ? "linear-gradient(90deg, transparent, #22c55e, transparent)"
              : isYellow
              ? "linear-gradient(90deg, transparent, #eab308, transparent)"
              : "linear-gradient(90deg, transparent, #ef4444, transparent)";

            return (
              <div
                key={gate.prefix}
                className={cn(
                  "relative flex flex-col gap-2 overflow-hidden rounded-lg border p-3",
                  borderColor,
                  bgColor
                )}
              >
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-50"
                  style={{ background: accentBg }}
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[#484f58]">
                    {gate.prefix}
                  </span>
                  <span className="text-xs font-semibold leading-tight text-[#e6edf3]">
                    {gate.name}
                  </span>
                  <span className="text-[10px] text-[#484f58]">
                    {GATE_PHASE_LABELS[gate.prefix] ?? gate.prefix}
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className={cn("font-mono text-xl font-bold tabular-nums", rateColor)}>
                    {gate.passRate}%
                  </span>
                </div>
                <div className="text-[11px] text-[#8b949e]">
                  {gate.passed}/{gate.total} passed
                </div>
                {gate.topFailureReason && (
                  <div
                    className="line-clamp-2 text-[10px] leading-snug text-[#484f58]"
                    title={gate.topFailureReason}
                  >
                    {gate.topFailureReason}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ── 3. Quality timeline ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TimelineTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as TimelinePoint;
  if (!d) return null;
  const color = ARTIFACT_COLOR[d.artifactType] ?? "#8b949e";
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3 text-xs shadow-xl">
      <div className="mb-1 font-semibold text-[#e6edf3]">{d.artifactName}</div>
      <div className="flex items-center gap-2 text-[#8b949e]">
        <span
          className="inline-block h-1.5 w-3 rounded-full"
          style={{ background: color }}
        />
        <span className="uppercase">{d.artifactType}</span>
        <span className="text-[#484f58]">·</span>
        <span>{d.date}</span>
      </div>
      <div className="mt-1.5 font-mono font-bold text-[#e6edf3]">
        Score: {d.qualityScore}
      </div>
      <div className="mt-0.5 capitalize text-[#8b949e]">{d.recommendation}</div>
    </div>
  );
}

function QualityTimeline({
  data,
  loading,
}: {
  data: TimelinePoint[];
  loading: boolean;
}) {
  const types = [...new Set(data.map((d) => d.artifactType))];

  return (
    <Panel>
      <SectionHeader
        icon={TrendingUp}
        label="Quality Score Timeline"
        sub="Score per review, color-coded by artifact type"
        right={
          <div className="flex items-center gap-3">
            {(["prd", "okr", "brief"] as const).map((t) => (
              <span key={t} className="flex items-center gap-1.5 text-[10px] text-[#484f58]">
                <span
                  className="inline-block h-1.5 w-4 rounded-full"
                  style={{ background: ARTIFACT_COLOR[t] }}
                />
                {t.toUpperCase()}
              </span>
            ))}
          </div>
        }
      />

      {loading ? (
        <Skeleton className="h-52 w-full" />
      ) : data.length === 0 ? (
        <EmptyState message="No reviews yet — submit an artifact to see quality trends." />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
            <XAxis
              dataKey="index"
              tick={{ fill: CHART_THEME.axis, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: CHART_THEME.axis, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<TimelineTooltip />} />
            {types.map((type) => (
              <Line
                key={type}
                type="monotone"
                dataKey={(d: TimelinePoint) =>
                  d.artifactType === type ? d.qualityScore : null
                }
                stroke={ARTIFACT_COLOR[type] ?? "#8b949e"}
                strokeWidth={1.5}
                dot={{ r: 3, fill: ARTIFACT_COLOR[type] ?? "#8b949e", strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 0 }}
                connectNulls={false}
                name={type.toUpperCase()}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

// ── 4. AI-era audit panel ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AiEraAuditTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3 text-xs shadow-xl">
      <div className="mb-1.5 font-semibold text-[#e6edf3]">{label}</div>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <div key={p.name} className="flex items-center gap-2" style={{ color: p.color }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
          <span className="capitalize">{p.name}:</span>
          <span className="font-mono font-bold text-[#e6edf3]">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function AiEraAuditPanel({
  data,
  loading,
}: {
  data: AiEraAuditAggregate | null;
  loading: boolean;
}) {
  const chartData = data
    ? [
        {
          name: "Eval Credibility",
          positive: data.evalCredibility.credible,
          warning: data.evalCredibility.questionable,
          missing: data.evalCredibility.missing,
        },
        {
          name: "Econ Defensibility",
          positive: data.economicDefensibility.strong,
          warning: data.economicDefensibility.weak,
          missing: data.economicDefensibility.missing,
        },
        {
          name: "Operability Realism",
          positive: data.operabilityRealism.realistic,
          warning: data.operabilityRealism.optimistic,
          missing: data.operabilityRealism.missing,
        },
        {
          name: "Compliance Readiness",
          positive: data.complianceReadiness.ready,
          warning: data.complianceReadiness.gaps,
          missing: data.complianceReadiness.missing,
        },
      ]
    : [];

  const positiveLabels: Record<string, string> = {
    "Eval Credibility": "Credible",
    "Econ Defensibility": "Strong",
    "Operability Realism": "Realistic",
    "Compliance Readiness": "Ready",
  };

  const warningLabels: Record<string, string> = {
    "Eval Credibility": "Questionable",
    "Econ Defensibility": "Weak",
    "Operability Realism": "Optimistic",
    "Compliance Readiness": "Gaps",
  };

  const hasData = chartData.some((d) => d.positive + d.warning + d.missing > 0);

  return (
    <Panel>
      <SectionHeader
        icon={BarChart2}
        label="AI-Era Audit"
        sub="Aggregate verdicts across all adversarial reviews"
        right={
          <div className="flex items-center gap-3">
            {[
              { color: "#22c55e", label: "Pass" },
              { color: "#eab308", label: "Warn" },
              { color: "#484f58", label: "Missing" },
            ].map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 text-[10px] text-[#484f58]">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
        }
      />
      {loading ? (
        <Skeleton className="h-44 w-full" />
      ) : !hasData ? (
        <EmptyState message="No AI-era audit data yet — submit a PRD to generate adversarial review data." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -22 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: CHART_THEME.axis, fontSize: 10 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: CHART_THEME.axis, fontSize: 10 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<AiEraAuditTooltip />} cursor={{ fill: "#161b22" }} />
              <Legend
                wrapperStyle={{ display: "none" }}
              />
              <Bar dataKey="positive" name="Pass" fill="#22c55e" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="warning" name="Warn" fill="#eab308" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="missing" name="Missing" fill="#30363d" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            {chartData.map((d) => (
              <div key={d.name} className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[#484f58]">{d.name}</span>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-emerald-400">{positiveLabels[d.name]}: {d.positive}</span>
                  <span className="text-[#30363d]">·</span>
                  <span className="text-yellow-400">{warningLabels[d.name]}: {d.warning}</span>
                  <span className="text-[#30363d]">·</span>
                  <span className="text-[#484f58]">Missing: {d.missing}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

// ── 5. Gate breakdown ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function GateTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const passed = payload.find((p: { dataKey: string }) => p.dataKey === "passed")?.value ?? 0;
  const failed = payload.find((p: { dataKey: string }) => p.dataKey === "failed")?.value ?? 0;
  const total = passed + failed;
  const rate = total > 0 ? Math.round((passed / total) * 100) : 0;
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3 text-xs shadow-xl">
      <div className="mb-1.5 font-semibold text-[#e6edf3]">{label}</div>
      <div className="flex flex-col gap-1 text-[#8b949e]">
        <span className="text-emerald-400">Passed: {passed}</span>
        <span className="text-red-400">Failed: {failed}</span>
        <span className="font-mono font-bold text-[#e6edf3]">{rate}% pass rate</span>
      </div>
    </div>
  );
}

function GateBreakdown({
  data,
  loading,
}: {
  data: GateBreakdownItem[];
  loading: boolean;
}) {
  return (
    <Panel>
      <SectionHeader
        icon={ShieldCheck}
        label="Gate Breakdown"
        sub="Pass / fail counts per hard gate"
      />
      {loading ? (
        <Skeleton className="h-52 w-full" />
      ) : data.length === 0 ? (
        <EmptyState message="No gate data yet." />
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(180, data.length * 36)}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 20, bottom: 0, left: 4 }}
            barCategoryGap="35%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={CHART_THEME.grid}
              horizontal={false}
            />
            <XAxis
              type="number"
              tick={{ fill: CHART_THEME.axis, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="gateName"
              width={140}
              tick={{ fill: CHART_THEME.axis, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<GateTooltip />} cursor={{ fill: "#161b22" }} />
            <Bar
              dataKey="passed"
              name="Passed"
              fill="#22c55e"
              radius={[0, 3, 3, 0]}
              stackId="s"
            />
            <Bar
              dataKey="failed"
              name="Failed"
              fill="#ef4444"
              radius={[0, 3, 3, 0]}
              stackId="s"
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

// ── 4. Findings donut ─────────────────────────────────────────────────────────

function FindingsDonut({
  data,
  loading,
}: {
  data: FindingCount[];
  loading: boolean;
}) {
  const total = data.reduce((s, d) => s + d.count, 0);

  return (
    <Panel>
      <SectionHeader
        icon={AlertTriangle}
        label="Adversarial Findings"
        sub="Aggregate finding types across all AI reviews"
      />
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Skeleton className="h-36 w-36 rounded-full" />
        </div>
      ) : data.length === 0 ? (
        <EmptyState message="No AI findings yet." />
      ) : (
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={46}
                  outerRadius={72}
                  paddingAngle={2}
                  dataKey="count"
                  isAnimationActive={false}
                  stroke="none"
                >
                  {data.map((_, i) => (
                    <Cell
                      key={i}
                      fill={FINDING_COLORS[i % FINDING_COLORS.length]}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-xl font-bold text-[#e6edf3]">
                {total}
              </span>
              <span className="text-[10px] text-[#484f58]">findings</span>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-2.5 min-w-0">
            {data.map((d, i) => {
              const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
              return (
                <div key={d.findingType} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{
                          background: FINDING_COLORS[i % FINDING_COLORS.length],
                        }}
                      />
                      <span className="truncate text-[11px] text-[#8b949e]">
                        {FINDING_LABELS[d.findingType] ?? d.findingType}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-semibold text-[#e6edf3]">
                      {d.count}
                    </span>
                  </div>
                  <div className="h-0.5 w-full rounded-full bg-[#161b22]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        background: FINDING_COLORS[i % FINDING_COLORS.length],
                        opacity: 0.7,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}

// ── 5. Recent reviews table ───────────────────────────────────────────────────

function RecentReviewsTable({
  data,
  loading,
}: {
  data: RecentReview[];
  loading: boolean;
}) {
  return (
    <Panel>
      <SectionHeader
        icon={FileText}
        label="Recent Reviews"
        sub="Last 10 pipeline runs"
        right={
          <span className="rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 font-mono text-[10px] text-[#484f58]">
            {data.length} / 10
          </span>
        }
      />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <EmptyState message="No reviews yet — POST to /api/review to run the pipeline." />
      ) : (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[#21262d]">
                {[
                  "Artifact",
                  "Type",
                  "Submitted",
                  "Score",
                  "Recommendation",
                  "Gates",
                  "Drift",
                  "",
                ].map((h, i) => (
                  <th
                    key={i}
                    className="pb-2.5 pr-4 text-left text-[10px] font-semibold uppercase tracking-widest text-[#484f58] last:pr-0"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, idx) => (
                <tr
                  key={r.id}
                  className={cn(
                    "group border-b border-[#21262d]/60 transition-colors last:border-0",
                    idx % 2 === 0 ? "bg-transparent" : "bg-[#0d1117]",
                    "hover:bg-[#161b22]"
                  )}
                >
                  <td className="max-w-[220px] py-3 pr-4">
                    <div className="flex items-center gap-2">
                      {r.blocked && (
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
                          title="Blocked by hard gate"
                        />
                      )}
                      <span className="truncate font-medium text-[#e6edf3]">
                        {r.artifactName}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <TypeChip type={r.artifactType} />
                  </td>
                  <td className="py-3 pr-4 font-mono text-[11px] tabular-nums text-[#484f58]">
                    {new Date(r.timestamp).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="py-3 pr-4">
                    <ScoreBadge score={r.qualityScore} />
                  </td>
                  <td className="py-3 pr-4">
                    <RecoBadge value={r.recommendation} />
                  </td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-1">
                      {(r.gateStatuses ?? []).map((passed, gi) => (
                        <span
                          key={gi}
                          className="inline-block h-2.5 w-2.5 rounded-full cursor-default"
                          style={{ background: passed ? "#22c55e" : "#ef4444" }}
                          title={`Gate ${gi + 1}: ${["Context Engineering","Synthetic Evals","ROI Moat","NFR Compliance","Operability","Success Metrics"][gi]} — ${passed ? "Passed" : "Failed"}`}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <DriftBadge verdict={r.driftVerdict} />
                  </td>
                  <td className="py-3">
                    <a
                      href={`/review?id=${r.id}`}
                      className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1 text-[11px] text-[#8b949e] opacity-0 transition-all group-hover:opacity-100 hover:border-[#484f58] hover:text-[#e6edf3]"
                    >
                      View Full Review
                      <ExternalLink size={10} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ── 6. Drift heatmap ──────────────────────────────────────────────────────────

function driftCellColor(score: number): string {
  if (score <= 15) return "#0d2818";
  if (score <= 40) return "#2d1f00";
  if (score <= 65) return "#3d1400";
  return "#2d0000";
}

function driftTextColor(score: number): string {
  if (score <= 15) return "#22c55e";
  if (score <= 40) return "#eab308";
  if (score <= 65) return "#f97316";
  return "#ef4444";
}

function DriftHeatmap({
  data,
  loading,
}: {
  data: DriftHeatmapPoint[];
  loading: boolean;
}) {
  const artifacts = [...new Set(data.map((d) => d.artifactLabel))].slice(0, 10);
  const dates = [...new Set(data.map((d) => d.date))].sort().slice(-12);

  const cellFor = (artifact: string, date: string) =>
    data.find((d) => d.artifactLabel === artifact && d.date === date) ?? null;

  return (
    <Panel>
      <SectionHeader
        icon={BarChart2}
        label="Drift Heatmap"
        sub="Drift score by artifact over time"
        right={
          <div className="flex items-center gap-2">
            {[
              { label: "Low", color: "#0d2818", text: "#22c55e" },
              { label: "Mod", color: "#2d1f00", text: "#eab308" },
              { label: "High", color: "#3d1400", text: "#f97316" },
              { label: "Crit", color: "#2d0000", text: "#ef4444" },
            ].map((l) => (
              <span
                key={l.label}
                className="flex items-center gap-1 text-[10px]"
                style={{ color: l.text }}
              >
                <span
                  className="inline-block h-2.5 w-3.5 rounded-sm"
                  style={{ background: l.color, border: `1px solid ${l.text}33` }}
                />
                {l.label}
              </span>
            ))}
          </div>
        }
      />

      {loading ? (
        <Skeleton className="h-28 w-full" />
      ) : data.length === 0 ? (
        <EmptyState message="No drift comparisons yet — POST to /api/drift to generate data." />
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="pb-2 pr-4 text-left font-normal text-[#484f58] w-36">
                  Artifact
                </th>
                {dates.map((d) => (
                  <th
                    key={d}
                    className="pb-2 px-1 text-center font-mono text-[10px] font-normal text-[#484f58]"
                  >
                    {d.slice(5)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {artifacts.map((artifact) => (
                <tr key={artifact}>
                  <td className="py-1 pr-4 max-w-[144px]">
                    <span
                      className="block truncate text-[11px] text-[#8b949e]"
                      title={artifact}
                    >
                      {artifact.replace(/^(PRD|OKR|Brief):\s*/i, "")}
                    </span>
                  </td>
                  {dates.map((date) => {
                    const cell = cellFor(artifact, date);
                    return (
                      <td key={date} className="px-0.5 py-1 text-center">
                        {cell ? (
                          <div
                            className="mx-auto flex h-7 w-10 items-center justify-center rounded font-mono text-[11px] font-bold tabular-nums"
                            style={{
                              background: driftCellColor(cell.driftScore),
                              color: driftTextColor(cell.driftScore),
                              border: `1px solid ${driftTextColor(cell.driftScore)}22`,
                            }}
                            title={`${artifact} · ${date}\nScore: ${cell.driftScore} (${cell.verdict})`}
                          >
                            {cell.driftScore}
                          </div>
                        ) : (
                          <div className="mx-auto h-7 w-10 rounded bg-[#161b22]" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [spinning, setSpinning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setSpinning(true);
    setLoading(!data); // full skeleton only on first load
    setError(null);

    try {
      const res = await fetch("/api/dashboard", { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
      const json = (await res.json()) as DashboardData;
      setData(json);
      setLastRefresh(new Date());
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setSpinning(false);
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void fetchData();
    return () => abortRef.current?.abort();
  }, [fetchData]);

  return (
    <div className="min-h-screen bg-[#010409] text-white">
      {/* Top nav ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-[#21262d] bg-[#0d1117]/95 backdrop-blur">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <span className="font-mono text-sm font-bold tracking-tight text-[#e6edf3]">
              PM OS Lite
            </span>
            <span className="text-[#30363d]">/</span>
            <span className="text-sm text-[#8b949e]">Quality Dashboard</span>
          </div>

          <div className="flex items-center gap-4">
            {lastRefresh && (
              <span className="hidden text-[11px] text-[#484f58] sm:block">
                Updated {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
            <button
              onClick={() => void fetchData()}
              disabled={spinning}
              className="flex items-center gap-2 rounded-md border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-xs text-[#8b949e] transition-colors hover:border-[#484f58] hover:text-[#e6edf3] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                size={12}
                className={spinning ? "animate-spin" : ""}
              />
              Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Error banner ─────────────────────────────────────────────────────── */}
      {error && (
        <div className="border-b border-red-900/50 bg-red-950/30 px-6 py-2.5">
          <div className="mx-auto flex max-w-screen-xl items-center gap-2 text-xs text-red-400">
            <AlertTriangle size={12} />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Content ──────────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-screen-xl px-6 py-6">
        <div className="flex flex-col gap-4">

          {/* 1. Stat cards */}
          <StatCards stats={data?.stats ?? null} loading={loading} />

          {/* 2. Gate health panel */}
          <GateHealthPanel data={data?.gateHealthPanel ?? []} loading={loading} />

          {/* 3. AI-era audit */}
          <AiEraAuditPanel data={data?.aiEraAuditAggregate ?? null} loading={loading} />

          {/* 4. Timeline + Findings */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <div className="xl:col-span-3">
              <QualityTimeline data={data?.timeline ?? []} loading={loading} />
            </div>
            <div className="xl:col-span-2">
              <FindingsDonut
                data={data?.findingsAggregate ?? []}
                loading={loading}
              />
            </div>
          </div>

          {/* 5. Gate breakdown + Drift heatmap */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <div className="xl:col-span-2">
              <GateBreakdown
                data={data?.gateBreakdown ?? []}
                loading={loading}
              />
            </div>
            <div className="xl:col-span-3">
              <DriftHeatmap
                data={data?.driftHeatmap ?? []}
                loading={loading}
              />
            </div>
          </div>

          {/* 6. Recent reviews */}
          <RecentReviewsTable
            data={data?.recentReviews ?? []}
            loading={loading}
          />

        </div>
      </main>

      {/* Footer ───────────────────────────────────────────────────────────── */}
      <footer className="mt-8 border-t border-[#21262d] px-6 py-4">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between">
          <span className="text-[10px] text-[#484f58]">
            PM OS Lite · Quality Dashboard
          </span>
          <a
            href="/review"
            className="flex items-center gap-1 text-[11px] text-[#484f58] transition-colors hover:text-[#8b949e]"
          >
            Run a review
            <ChevronRight size={11} />
          </a>
        </div>
      </footer>
    </div>
  );
}
