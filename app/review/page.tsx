"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface AdversarialFinding {
  section: string;
  findingType: string;
  description: string;
  suggestedQuestion: string;
  severity: 1 | 2 | 3;
}

interface ReviewReport {
  artifactId: string | null;
  artifactName: string;
  artifactType: string;
  timestamp: string;
  hardGates: {
    passed: boolean;
    gateName: string;
    reason: string;
  }[];
  softGates: {
    passed: boolean;
    gateName: string;
    warning: string;
    suggestion: string;
    weight: number;
  }[];
  adversarialReview: {
    overallRisk: "low" | "medium" | "high" | "critical";
    findings: AdversarialFinding[];
    redFlags: string[];
    strengthSignals: string[];
  };
  qualityScore: number;
  recommendation: "approve" | "revise" | "reject";
  blocked: boolean;
}

export default function ReviewPage() {
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [recentReports, setRecentReports] = useState<ReviewReport[]>([]);

  useEffect(() => {
    // Read last submitted report from sessionStorage
    try {
      const stored = sessionStorage.getItem("lastReviewReport");
      if (stored) setReport(JSON.parse(stored));
    } catch {
      // ignore
    }

    // Also fetch recent reports from the API
    fetch("/api/review?limit=5")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setRecentReports(data);
      })
      .catch(() => {});
  }, []);

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">AI Review</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Quality gate results and adversarial review output
          </p>
        </div>
        <a
          href="/submit"
          className="text-sm font-medium text-primary hover:underline"
        >
          + Submit artifact →
        </a>
      </div>

      {report ? (
        <ReportDetail report={report} />
      ) : (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          <p className="text-sm">No review in this session.</p>
          <a
            href="/submit"
            className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
          >
            Submit an artifact to run a review →
          </a>
        </div>
      )}

      {recentReports.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            Recent Reviews
          </h2>
          <div className="space-y-2">
            {recentReports.map((r, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border px-4 py-3 text-sm"
              >
                <div className="flex items-center gap-3">
                  <Badge
                    variant={
                      r.recommendation === "approve"
                        ? "success"
                        : r.recommendation === "reject"
                        ? "destructive"
                        : "warning"
                    }
                    className="text-xs capitalize"
                  >
                    {r.recommendation}
                  </Badge>
                  <span className="font-medium truncate max-w-xs">
                    {(r as unknown as Record<string, string>).artifact_name ??
                      r.artifactName ??
                      "—"}
                  </span>
                </div>
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {(r as unknown as Record<string, number>).quality_score ??
                    r.qualityScore ??
                    "—"}
                  /100
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function ReportDetail({ report }: { report: ReviewReport }) {
  const rec = report.recommendation;
  const recStyles = {
    approve: "border-green-300 bg-green-50 text-green-800",
    revise: "border-amber-300 bg-amber-50 text-amber-800",
    reject: "border-red-300 bg-red-50 text-red-800",
  }[rec];

  const riskStyles = {
    low: "bg-green-100 text-green-800",
    medium: "bg-amber-100 text-amber-800",
    high: "bg-red-100 text-red-800",
    critical: "bg-red-900 text-red-100",
  }[report.adversarialReview.overallRisk];

  return (
    <div className="space-y-5">
      {/* Verdict */}
      <div
        className={cn(
          "rounded-xl border-2 px-6 py-5 flex items-center justify-between",
          recStyles
        )}
      >
        <div>
          <div className="font-bold text-lg uppercase tracking-wide">{rec}</div>
          <div className="text-sm opacity-75 mt-0.5">{report.artifactName}</div>
        </div>
        <div className="text-right">
          <div className="text-4xl font-bold">{report.qualityScore}</div>
          <div className="text-xs opacity-60">/ 100</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Hard gates */}
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
                      "shrink-0 font-bold",
                      g.passed ? "text-green-600" : "text-red-600"
                    )}
                  >
                    {g.passed ? "✓" : "✕"}
                  </span>
                  <div>
                    <p className="font-mono font-semibold">{g.gateName}</p>
                    <p className={g.passed ? "text-green-700" : "text-red-700"}>
                      {g.reason}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Soft gates */}
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
                      "shrink-0",
                      g.passed ? "text-green-600" : "text-amber-600"
                    )}
                  >
                    {g.passed ? "✓" : "⚠"}
                  </span>
                  <div>
                    <p className="font-mono font-semibold">{g.gateName}</p>
                    <p className={g.passed ? "text-green-700" : "text-amber-700"}>
                      {g.passed ? g.warning : g.suggestion}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Adversarial review */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
            Adversarial Review
            <span
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-full font-semibold normal-case",
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
              <ul className="space-y-1">
                {report.adversarialReview.redFlags.map((f, i) => (
                  <li key={i} className="flex gap-2 text-xs text-red-700">
                    <span>🚩</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
                <span className="font-mono font-semibold">{f.section}</span>
                <Badge variant="outline" className="text-[9px] px-1 py-0">
                  {f.findingType}
                </Badge>
              </div>
              <p>{f.description}</p>
              <p className="text-muted-foreground mt-1 italic">
                Q: {f.suggestedQuestion}
              </p>
            </div>
          ))}
          {report.adversarialReview.strengthSignals.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-green-700 mb-2">
                Strengths
              </p>
              <ul className="space-y-1">
                {report.adversarialReview.strengthSignals.map((s, i) => (
                  <li key={i} className="flex gap-2 text-xs text-green-700">
                    <span>✓</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!report.adversarialReview.findings.length &&
            !report.adversarialReview.redFlags.length &&
            !report.adversarialReview.strengthSignals.length && (
              <p className="text-sm text-muted-foreground">
                No adversarial findings.
              </p>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
