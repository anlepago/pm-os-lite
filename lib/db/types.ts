export interface Product {
  id: number;
  name: string;
  description: string | null;
  owner: string | null;
  created_at: string;
  updated_at: string;
}

export interface PRD {
  id: number;
  product_id: number;
  title: string;
  content: string;
  status: "draft" | "review" | "approved" | "deprecated";
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Artifact {
  id: number;
  prd_id: number;
  type: "ticket" | "spec" | "design" | "test_plan";
  title: string;
  content: string;
  source_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Review {
  id: number;
  artifact_id: number | null;
  prd_id: number | null;
  agent: "reviewer" | "drift_detector";
  score: number | null;
  summary: string;
  issues: string[];
  suggestions: string[];
  raw_output: string | null;
  created_at: string;
}

export interface Metric {
  id: number;
  product_id: number;
  metric: string;
  value: number;
  recorded_at: string;
}
