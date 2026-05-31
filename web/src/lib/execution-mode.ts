type ComplexityLevel = "simple" | "medium" | "complex" | "deep" | string;
type AnalysisMode = "direct" | "sequential" | "parallel" | "expert_team" | "deep" | string;

interface ComplexityAnalysis {
  level?: ComplexityLevel;
  mode?: AnalysisMode;
  agentCount?: number;
}

type CollaborationMode = "sequential" | "parallel" | "expert_team";

type AutoExecution =
  | { kind: "direct"; mode: "direct"; agentCount: number }
  | { kind: "deep"; mode: "deep"; agentCount: number }
  | { kind: "collaboration"; mode: CollaborationMode; agentCount: number };

function normalizeAgentCount(agentCount: unknown): number {
  return typeof agentCount === "number" && agentCount >= 1 ? agentCount : 1;
}

export function resolveAutoExecution(analysis: ComplexityAnalysis): AutoExecution {
  const agentCount = normalizeAgentCount(analysis.agentCount);

  if (analysis.level === "simple" && analysis.mode === "direct") {
    return { kind: "direct", mode: "direct", agentCount };
  }

  if (analysis.level === "deep" || analysis.mode === "deep") {
    return { kind: "deep", mode: "deep", agentCount };
  }

  if (analysis.level === "medium") {
    return {
      kind: "collaboration",
      mode: analysis.mode === "parallel" ? "parallel" : "sequential",
      agentCount,
    };
  }

  return {
    kind: "collaboration",
    mode:
      analysis.mode === "sequential" || analysis.mode === "parallel"
        ? analysis.mode
        : "expert_team",
    agentCount,
  };
}
