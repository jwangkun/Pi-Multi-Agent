"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { resolveAutoExecution } from "@/lib/execution-mode";
import { getRestoreMessage } from "@/lib/session-restore-message";
import {
  Bot,
  Send,
  Sparkles,
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  Zap,
  Brain,
  Plus,
  Trash2,
  Activity,
  FileText,
  Users,
  Radio,
  Target,
  Clock,
  History,
  BarChart3,
  Wrench,
  ChevronDown,
  ChevronRight,
  Download,
  ArrowRight,
  RefreshCw,
  MessageCircle,
} from "lucide-react";

const API_BASE = "http://localhost:3001";
const WS_HOST = "localhost:3001";

interface AgentInfo {
  id: string;
  name: string;
  description: string;
  capabilities?: string[];
  reason?: string;
  state?: string;
  tools?: string[];
  assignedTask?: string;
  priority?: string;
}

interface SubTaskInfo {
  id: string;
  title: string;
  description?: string;
  assignedAgentName: string;
  assignedAgentType: string;
  dependencies: string[];
  priority: string;
  tools: string[];
  expectedOutput?: string;
  status?: "pending" | "running" | "completed" | "failed" | "retrying";
  progress?: number;
  output?: string;
  outputLength?: number;
  startTime?: number;
  endTime?: number;
  error?: string;
}

interface PlanInfo {
  id: string;
  goal: string;
  subTaskCount: number;
  collaborationMode: string;
  communicationStructure?: string;
  executionStrategy?: string;
  subTasks: SubTaskInfo[];
  successCriteria?: string[];
  qualityThresholds?: {
    minWordCount: number;
    minSections: number;
    requireDataSupport: boolean;
    requireReferences: boolean;
  };
}

interface FormField {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "textarea";
  required?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  validation?: { pattern?: string; message?: string };
}

interface ActionButton {
  key: string;
  label: string;
  variant: "primary" | "secondary" | "danger";
  submit?: boolean;
}

interface HumanInLoopMessage {
  taskId: string;
  stepId: string;
  status: "WAITING_INPUT" | "CONFIRMATION" | "PROCESSING" | "COMPLETED" | "ERROR";
  uiSchema?: {
    type: "form" | "confirm-card" | "selection-list";
    title?: string;
    description?: string;
    fields?: FormField[];
    actions?: ActionButton[];
  };
  contextHint?: string;
  defaultValues?: Record<string, any>;
}

interface ChatMessage {
  id: string;
  type: "user" | "agent" | "system" | "tool_call" | "tool_result" | "evaluation" | "result" | "human_input";
  agentName?: string;
  agentId?: string;
  text: string;
  timestamp: number;
  thinking?: boolean;
  toolCall?: string;
  toolResult?: string;
  toolInput?: Record<string, unknown>;
  toolDuration?: number;
  toolSuccess?: boolean;
  evaluationData?: {
    score: number;
    deepScore?: number;
    dimensions?: Array<{ name: string; score: number; passed: boolean; feedback: string }>;
    strengths?: string[];
    weaknesses?: string[];
    suggestions?: string[];
  };
  resultData?: {
    content: string;
    length: number;
    tokens: number;
    mode: string;
    agentCount: number;
  };
  hilData?: HumanInLoopMessage;
}

interface ExecutionStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  runningTasks: number;
  totalTokens: number;
  executionTime: number;
  evaluationScore: number;
  iterations: number;
  finalOutputLength: number;
}

interface SessionSummary {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: "idle" | "running" | "completed" | "failed";
  mode?: string;
  task?: string;
  finalOutputLength: number;
  evaluationScore?: number;
  iterations?: number;
  error?: string;
}

interface PersistedSessionDetail extends SessionSummary {
  plan?: PlanInfo;
  result?: {
    success: boolean;
    finalOutput: string;
    totalExecutionTime: number;
    totalTokensUsed: number;
    evaluationScore: number;
    iterations: number;
    progress?: Array<{
      taskId: string;
      status: "pending" | "running" | "completed" | "failed" | "retrying";
      progress: number;
      outputLength?: number;
      error?: string;
    }>;
  };
  workflowResult?: {
    success: boolean;
    output: unknown;
    totalTokens: number;
    totalExecutionTime: number;
    snapshot?: unknown;
    error?: string;
  };
}

const AGENT_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-teal-500",
  "bg-pink-500",
  "bg-indigo-500",
];

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  normal: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  low: "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {};

function getAgentInitial(name: string): string {
  const chars = name.replace(/[^\u4e00-\u9fa5a-zA-Z]/g, "");
  if (/[\u4e00-\u9fa5]/.test(chars)) return chars.substring(0, 1);
  return chars.substring(0, 2).toUpperCase();
}

interface WorkflowPhaseInfo {
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  agents: WorkflowAgentInfo[];
  startedAt?: number;
  completedAt?: number;
}

interface WorkflowAgentInfo {
  id: number;
  label: string;
  phase: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: number;
  completedAt?: number;
  error?: string;
  outputLength?: number;
}

export default function MultiAgentUI() {
  const [sessionId, setSessionId] = useState<string>("");
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [taskInput, setTaskInput] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentMode, setCurrentMode] = useState("auto");
  const [wsConnected, setWsConnected] = useState(false);
  const [rightTab, setRightTab] = useState("plan");
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [subTasks, setSubTasks] = useState<SubTaskInfo[]>([]);
  const [stats, setStats] = useState<ExecutionStats | null>(null);
  const [finalOutput, setFinalOutput] = useState<string>("");
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [restoringSessionId, setRestoringSessionId] = useState<string>("");
  const [workflowPhases, setWorkflowPhases] = useState<WorkflowPhaseInfo[]>([]);
  const [workflowMeta, setWorkflowMeta] = useState<{ name: string; description: string } | null>(null);
  const [workflowCurrentPhase, setWorkflowCurrentPhase] = useState<string>("");
  const [workflowAgentMap, setWorkflowAgentMap] = useState<Map<number, WorkflowAgentInfo>>(new Map());
  const [evaluationResult, setEvaluationResult] = useState<{
    score: number;
    deepScore?: number;
    dimensions?: Array<{ name: string; score: number; passed: boolean; feedback: string }>;
    strengths?: string[];
    weaknesses?: string[];
    suggestions?: string[];
  } | null>(null);
  const [executionPhase, setExecutionPhase] = useState<"idle" | "planning" | "executing" | "evaluating" | "completed" | "failed">("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const handleWSMessageRef = useRef<(msg: any) => void>(() => {});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const agentColorMap = useRef<Map<string, number>>(new Map());
  const colorCounter = useRef(0);

  const getAgentColor = useCallback((agentId: string) => {
    if (!agentColorMap.current.has(agentId)) {
      agentColorMap.current.set(agentId, colorCounter.current);
      colorCounter.current = (colorCounter.current + 1) % AGENT_COLORS.length;
    }
    return AGENT_COLORS[agentColorMap.current.get(agentId)!];
  }, []);

  const scrollToBottom = useCallback(() => {
    const container = document.getElementById("chat-scroll-container");
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const clearWorkspace = useCallback((clearSession: boolean = true) => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (clearSession) {
      setSessionId("");
      localStorage.removeItem("pi-multi-agent:last-session-id");
    }
    setMessages([]);
    setAgents([]);
    setPlan(null);
    setSubTasks([]);
    setStats(null);
    setFinalOutput("");
    setEvaluationResult(null);
    setExecutionPhase("idle");
    setWorkflowPhases([]);
    setWorkflowMeta(null);
    setWorkflowCurrentPhase("");
    setWorkflowAgentMap(new Map());
    setIsExecuting(false);
  }, []);

  const loadRecentSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const res = await fetch(`${API_BASE}/api/sessions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRecentSessions(data.sessions || []);
    } catch {
      setRecentSessions([]);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  const connectWS = useCallback((sid: string) => {
    if (wsRef.current) wsRef.current.close();
    const ws = new WebSocket(`ws://${WS_HOST}/ws?sessionId=${sid}`);
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => {
      setWsConnected(false);
      if (wsRef.current === ws) {
        setTimeout(() => { if (wsRef.current === ws && sid) connectWS(sid); }, 3000);
      }
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleWSMessageRef.current(msg);
    };
    wsRef.current = ws;
  }, []);

  const handleWSMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case "agent_thinking":
        setMessages((prev) => [
          ...prev.filter((m) => !(m.agentId === msg.agentId && m.thinking)),
          {
            id: `thinking-${msg.agentId}-${Date.now()}`,
            type: "agent",
            agentName: msg.agentName,
            agentId: msg.agentId,
            text: "",
            timestamp: Date.now(),
            thinking: true,
          },
        ]);
        setSubTasks((prev) =>
          prev.map((t) =>
            t.id === msg.taskId ? { ...t, status: "running" as const } : t
          )
        );
        break;

      case "agent_response":
        setMessages((prev) => [
          ...prev.filter((m) => !(m.agentId === msg.agentId && m.thinking)),
          {
            id: `resp-${msg.agentId}-${Date.now()}`,
            type: "agent",
            agentName: msg.agentName,
            agentId: msg.agentId,
            text: msg.text,
            timestamp: Date.now(),
          },
        ]);
        setSubTasks((prev) =>
          prev.map((t) =>
            t.id === msg.taskId
              ? { ...t, status: "completed" as const, progress: 100, output: msg.text, outputLength: msg.text?.length || 0 }
              : t
          )
        );
        break;

      case "agent_error":
        setMessages((prev) => [
          ...prev.filter((m) => !(m.agentId === msg.agentId && m.thinking)),
          {
            id: `err-${Date.now()}`,
            type: "system",
            text: `${msg.agentName}: ${msg.error}`,
            timestamp: Date.now(),
          },
        ]);
        setSubTasks((prev) =>
          prev.map((t) =>
            t.id === msg.taskId ? { ...t, status: "failed" as const, error: msg.error } : t
          )
        );
        break;

      case "planning_started":
        setExecutionPhase("planning");
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: "Planning task decomposition...", timestamp: Date.now() },
        ]);
        break;

      case "planning_completed":
      case "plan_created":
        setExecutionPhase("executing");
        if (msg.plan) {
          setPlan(msg.plan);
          setSubTasks(
            msg.plan.subTasks.map((t: SubTaskInfo) => ({
              ...t,
              status: "pending" as const,
              progress: 0,
            }))
          );
          setAgents(
            msg.plan.subTasks.map((t: SubTaskInfo, i: number) => ({
              id: t.id,
              name: t.assignedAgentName,
              description: t.title,
              capabilities: [t.assignedAgentType],
              tools: t.tools,
              assignedTask: t.title,
              priority: t.priority,
              state: "idle",
            }))
          );
          setMessages((prev) => [
            ...prev,
            {
              id: `sys-plan-${Date.now()}`,
              type: "system",
              text: `Plan created: ${msg.plan.subTaskCount} subtasks, ${msg.plan.collaborationMode} mode`,
              timestamp: Date.now(),
            },
          ]);
        }
        break;

      case "cluster_event":
        handleClusterEvent(msg);
        break;

      case "cluster_execution_started":
        setExecutionPhase("executing");
        setIsExecuting(true);
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `Cluster execution started: ${msg.task}`, timestamp: Date.now() },
        ]);
        break;

      case "cluster_execution_completed":
        setExecutionPhase("completed");
        setIsExecuting(false);
        if (msg.result) {
          const output = msg.result.finalOutput || "";
          if (output) setFinalOutput(output);
          setStats({
            totalTasks: subTasks.length,
            completedTasks: subTasks.filter((t) => t.status === "completed").length,
            failedTasks: subTasks.filter((t) => t.status === "failed").length,
            runningTasks: 0,
            totalTokens: msg.result.totalTokensUsed || 0,
            executionTime: msg.result.totalExecutionTime || 0,
            evaluationScore: msg.result.evaluationScore || 0,
            iterations: msg.result.iterations || 1,
            finalOutputLength: output.length || msg.result.finalOutputLength || 0,
          });
          setRightTab("report");
        }
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `Execution completed! Score: ${msg.result?.evaluationScore?.toFixed(2) || "N/A"}`, timestamp: Date.now() },
        ]);
        break;

      case "cluster_execution_error":
        setExecutionPhase("failed");
        setIsExecuting(false);
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `Execution failed: ${msg.error}`, timestamp: Date.now() },
        ]);
        break;

      case "execution_start":
        setIsExecuting(true);
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `Task started: ${msg.task} (${msg.agentCount} agents, ${msg.mode} mode)`, timestamp: Date.now() },
        ]);
        break;

      case "execution_complete":
        setIsExecuting(false);
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `Task completed! Time: ${msg.executionTime}ms`, timestamp: Date.now() },
        ]);
        break;

      case "execution_error":
        setIsExecuting(false);
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `Execution failed: ${msg.error}`, timestamp: Date.now() },
        ]);
        break;

      case "evaluation":
        setExecutionPhase("evaluating");
        const evalData = msg.data as any;
        const evalResult = {
          score: evalData?.score || 0,
          deepScore: evalData?.deepScore,
          dimensions: evalData?.dimensions,
          strengths: evalData?.strengths,
          weaknesses: evalData?.weaknesses,
          suggestions: evalData?.suggestions,
        };
        setEvaluationResult(evalResult);
        setMessages((prev) => [
          ...prev,
          {
            id: `sys-eval-${Date.now()}`,
            type: "evaluation",
            text: `Evaluation: ${((evalData?.score || 0) * 100)?.toFixed(0)}%`,
            timestamp: Date.now(),
            evaluationData: evalResult,
          },
        ]);
        break;

      case "workflow_started":
        setExecutionPhase("planning");
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `Workflow started: ${msg.task}`, timestamp: Date.now() },
        ]);
        break;

      case "workflow_event":
        const wfEvt = msg.data as any;
        if (wfEvt.type === "workflow:started") {
          const phases = (wfEvt.meta?.phases || []).map((p: any) => ({
            title: p.title || p,
            status: "pending" as const,
            agents: [],
          }));
          setWorkflowPhases(phases);
          setWorkflowMeta({ name: wfEvt.meta?.name || "Workflow", description: wfEvt.meta?.description || "" });
          setWorkflowAgentMap(new Map());
          setPlan({
            id: wfEvt.meta?.name || "workflow",
            goal: wfEvt.meta?.description || "",
            subTaskCount: 0,
            collaborationMode: "workflow",
            subTasks: [],
          });
          setSubTasks([]);
          setAgents([]);
          setRightTab("workflow");
          setMessages((prev) => [
            ...prev,
            { id: `sys-${Date.now()}`, type: "system", text: `Workflow: ${wfEvt.meta?.name || "unknown"} — ${phases.length} phases planned`, timestamp: Date.now() },
          ]);
        } else if (wfEvt.type === "phase:changed") {
          setExecutionPhase("executing");
          setWorkflowCurrentPhase(wfEvt.phase);
          setWorkflowPhases((prev) =>
            prev.map((p) =>
              p.title === wfEvt.phase
                ? { ...p, status: "running" as const, startedAt: Date.now() }
                : p.status === "pending"
                ? p
                : p
            )
          );
          setMessages((prev) => [
            ...prev,
            { id: `sys-${Date.now()}`, type: "system", text: `▶ Phase: ${wfEvt.phase}`, timestamp: Date.now() },
          ]);
        } else if (wfEvt.type === "agent:started") {
          const agentInfo: WorkflowAgentInfo = {
            id: wfEvt.agentId,
            label: wfEvt.label,
            phase: wfEvt.phase,
            status: "running",
            startedAt: Date.now(),
          };
          setWorkflowAgentMap((prev) => {
            const next = new Map(prev);
            next.set(wfEvt.agentId, agentInfo);
            return next;
          });
          setWorkflowPhases((prev) =>
            prev.map((p) =>
              p.title === wfEvt.phase
                ? { ...p, agents: [...p.agents.filter((a) => a.id !== wfEvt.agentId), agentInfo] }
                : p
            )
          );
          setAgents((prev) => {
            const exists = prev.find((a) => a.id === `wf-${wfEvt.agentId}`);
            if (exists) return prev.map((a) => a.id === `wf-${wfEvt.agentId}` ? { ...a, state: "running" } : a);
            return [...prev, {
              id: `wf-${wfEvt.agentId}`,
              name: wfEvt.label,
              description: wfEvt.phase,
              capabilities: ["workflow"],
              state: "running",
              assignedTask: wfEvt.phase,
            }];
          });
          setSubTasks((prev) => {
            const exists = prev.find((t) => t.id === `wf-${wfEvt.agentId}`);
            if (exists) return prev.map((t) => t.id === `wf-${wfEvt.agentId}` ? { ...t, status: "running" as const } : t);
            return [...prev, {
              id: `wf-${wfEvt.agentId}`,
              title: wfEvt.label,
              assignedAgentName: wfEvt.label,
              assignedAgentType: "workflow-agent",
              dependencies: [],
              priority: "normal",
              tools: [],
              status: "running" as const,
              progress: 10,
              startTime: Date.now(),
            }];
          });
          setMessages((prev) => [
            ...prev.filter((m) => !(m.agentId === `wf-${wfEvt.agentId}` && m.thinking)),
            {
              id: `thinking-wf-${wfEvt.agentId}-${Date.now()}`,
              type: "agent",
              agentName: wfEvt.label,
              agentId: `wf-${wfEvt.agentId}`,
              text: "",
              timestamp: Date.now(),
              thinking: true,
            },
          ]);
        } else if (wfEvt.type === "agent:completed") {
          setWorkflowAgentMap((prev) => {
            const next = new Map(prev);
            const existing = next.get(wfEvt.agentId);
            if (existing) {
              next.set(wfEvt.agentId, { ...existing, status: "completed", completedAt: Date.now(), outputLength: wfEvt.outputLength });
            }
            return next;
          });
          setWorkflowPhases((prev) =>
            prev.map((p) => ({
              ...p,
              agents: p.agents.map((a) =>
                a.id === wfEvt.agentId ? { ...a, status: "completed" as const, completedAt: Date.now(), outputLength: wfEvt.outputLength } : a
              ),
            }))
          );
          setAgents((prev) => prev.map((a) => a.id === `wf-${wfEvt.agentId}` ? { ...a, state: "completed" } : a));
          setSubTasks((prev) => prev.map((t) =>
            t.id === `wf-${wfEvt.agentId}` ? { ...t, status: "completed" as const, progress: 100, endTime: Date.now(), outputLength: wfEvt.outputLength } : t
          ));
          setMessages((prev) => [
            ...prev.filter((m) => !(m.agentId === `wf-${wfEvt.agentId}` && m.thinking)),
            {
              id: `resp-wf-${wfEvt.agentId}-${Date.now()}`,
              type: "agent",
              agentName: wfEvt.label,
              agentId: `wf-${wfEvt.agentId}`,
              text: `✓ Completed (${wfEvt.outputLength || 0} chars)`,
              timestamp: Date.now(),
            },
          ]);
        } else if (wfEvt.type === "agent:failed") {
          setWorkflowAgentMap((prev) => {
            const next = new Map(prev);
            const existing = next.get(wfEvt.agentId);
            if (existing) {
              next.set(wfEvt.agentId, { ...existing, status: "failed", error: wfEvt.error, completedAt: Date.now() });
            }
            return next;
          });
          setWorkflowPhases((prev) =>
            prev.map((p) => ({
              ...p,
              agents: p.agents.map((a) =>
                a.id === wfEvt.agentId ? { ...a, status: "failed" as const, error: wfEvt.error, completedAt: Date.now() } : a
              ),
            }))
          );
          setAgents((prev) => prev.map((a) => a.id === `wf-${wfEvt.agentId}` ? { ...a, state: "failed" } : a));
          setSubTasks((prev) => prev.map((t) => t.id === `wf-${wfEvt.agentId}` ? { ...t, status: "failed" as const, error: wfEvt.error } : t));
          setMessages((prev) => [
            ...prev.filter((m) => !(m.agentId === `wf-${wfEvt.agentId}` && m.thinking)),
            {
              id: `err-wf-${Date.now()}`,
              type: "system",
              text: `✗ ${wfEvt.label} failed: ${wfEvt.error}`,
              timestamp: Date.now(),
            },
          ]);
        } else if (wfEvt.type === "agent:skipped") {
          setWorkflowAgentMap((prev) => {
            const next = new Map(prev);
            const existing = next.get(wfEvt.agentId);
            if (existing) {
              next.set(wfEvt.agentId, { ...existing, status: "skipped", completedAt: Date.now() });
            }
            return next;
          });
          setAgents((prev) => prev.map((a) => a.id === `wf-${wfEvt.agentId}` ? { ...a, state: "completed" } : a));
          setSubTasks((prev) => prev.map((t) => t.id === `wf-${wfEvt.agentId}` ? { ...t, status: "completed" as const, progress: 100 } : t));
        } else if (wfEvt.type === "workflow:log") {
          setMessages((prev) => [
            ...prev,
            { id: `sys-${Date.now()}`, type: "system", text: wfEvt.message, timestamp: Date.now() },
          ]);
        } else if (wfEvt.type === "workflow:completed") {
          const wfResult = wfEvt.result;
          if (wfResult?.snapshot) {
            finalizeWorkflowState(wfResult.snapshot, wfResult.totalTokens, wfResult.totalExecutionTime);
          }
        } else if (wfEvt.type === "workflow:failed") {
          setExecutionPhase("failed");
          setMessages((prev) => [
            ...prev,
            { id: `sys-${Date.now()}`, type: "system", text: `Workflow failed: ${wfEvt.error}`, timestamp: Date.now() },
          ]);
        }
        break;

      case "workflow_completed":
        setExecutionPhase("completed");
        if (msg.result?.snapshot) {
          finalizeWorkflowState(msg.result.snapshot, msg.result.totalTokens, msg.result.totalExecutionTime);
        }
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `Workflow completed! Tokens: ${msg.result?.totalTokens?.toLocaleString() || 0}`, timestamp: Date.now() },
        ]);
        break;

      case "workflow_error":
        setExecutionPhase("failed");
        setMessages((prev) => [
          ...prev,
          { id: `sys-${Date.now()}`, type: "system", text: `Workflow error: ${msg.error}`, timestamp: Date.now() },
        ]);
        break;
    }
  }, [subTasks]);

  useEffect(() => {
    handleWSMessageRef.current = handleWSMessage;
  }, [handleWSMessage]);

  const finalizeWorkflowState = (snap: any, totalTokens: number, totalTime: number) => {
    setWorkflowPhases((prev) =>
      prev.map((p) => {
        const allDone = p.agents.length > 0 && p.agents.every((a) => a.status === "completed" || a.status === "failed" || a.status === "skipped");
        return { ...p, status: allDone ? "completed" as const : p.status === "running" ? "completed" as const : p.status, completedAt: Date.now() };
      })
    );
    const agentList = snap.agents || [];
    setPlan((prev) => prev ? { ...prev, subTaskCount: agentList.length } : null);
    setStats({
      totalTasks: agentList.length,
      completedTasks: agentList.filter((a: any) => a.status === "completed").length,
      failedTasks: agentList.filter((a: any) => a.status === "failed").length,
      runningTasks: 0,
      totalTokens: totalTokens || 0,
      executionTime: totalTime || 0,
      evaluationScore: 0,
      iterations: 1,
      finalOutputLength: finalOutput.length || 0,
    });
    setExecutionPhase("completed");
    setRightTab("report");
  };

  const handleClusterEvent = useCallback((msg: any) => {
    const { eventType, taskId, agentName, data } = msg;

    switch (eventType) {
      case "task_started":
        setSubTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: "running" as const, progress: 10, startTime: Date.now() } : t
          )
        );
        setAgents((prev) =>
          prev.map((a) =>
            a.assignedTask === (data as any)?.task ? { ...a, state: "running" } : a
          )
        );
        break;

      case "task_completed":
        setSubTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: "completed" as const, progress: 100, endTime: Date.now(), outputLength: (data as any)?.outputLength || 0 } : t
          )
        );
        break;

      case "task_failed":
        setSubTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: "failed" as const, error: (data as any)?.error } : t
          )
        );
        break;

      case "agent_thinking":
        setMessages((prev) => [
          ...prev.filter((m) => !(m.agentId === taskId && m.thinking)),
          {
            id: `thinking-${taskId}-${Date.now()}`,
            type: "agent",
            agentName: agentName || "Agent",
            agentId: taskId,
            text: "",
            timestamp: Date.now(),
            thinking: true,
          },
        ]);
        break;

      case "agent_response":
        setMessages((prev) => [
          ...prev.filter((m) => !(m.agentId === taskId && m.thinking)),
          {
            id: `resp-${taskId}-${Date.now()}`,
            type: "agent",
            agentName: agentName || "Agent",
            agentId: taskId,
            text: (data as any)?.outputLength ? `[Output: ${(data as any).outputLength} chars]` : "",
            timestamp: Date.now(),
          },
        ]);
        break;

      case "tool_call":
        setMessages((prev) => [
          ...prev,
          {
            id: `tool-call-${taskId}-${Date.now()}`,
            type: "tool_call",
            agentName: agentName || "Agent",
            agentId: taskId,
            text: `${(data as any)?.toolName || "unknown"}`,
            timestamp: Date.now(),
            toolCall: (data as any)?.toolName,
            toolInput: (data as any)?.input,
          },
        ]);
        break;

      case "tool_result":
        setMessages((prev) => [
          ...prev,
          {
            id: `tool-result-${taskId}-${Date.now()}`,
            type: "tool_result",
            agentName: agentName || "Agent",
            agentId: taskId,
            text: `${(data as any)?.toolName || "unknown"}`,
            timestamp: Date.now(),
            toolResult: (data as any)?.toolName,
            toolDuration: (data as any)?.duration,
            toolSuccess: (data as any)?.success,
          },
        ]);
        break;
    }
  }, []);

  const restoreSession = useCallback(async (sid: string) => {
    setRestoringSessionId(sid);
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sid}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const restored = data.session as PersistedSessionDetail;
      const active = Boolean(data.active);
      const clusterOutput = restored.result?.finalOutput || "";
      const workflowOutput =
        typeof restored.workflowResult?.output === "string"
          ? restored.workflowResult.output
          : restored.workflowResult?.output
          ? JSON.stringify(restored.workflowResult.output, null, 2)
          : "";
      const output = clusterOutput || workflowOutput;
      const isInterrupted = restored.status === "running" && !active;
      const restoredPlan = restored.plan || null;
      const progressByTask = new Map((restored.result?.progress || []).map((item) => [item.taskId, item]));
      const restoredTasks = (restoredPlan?.subTasks || []).map((task) => {
        const progress = progressByTask.get(task.id);
        return {
          ...task,
          status: progress?.status || (restored.status === "completed" ? "completed" as const : "pending" as const),
          progress: progress?.progress ?? (restored.status === "completed" ? 100 : 0),
          outputLength: progress?.outputLength,
          error: progress?.error,
        };
      });

      setSessionId(restored.id);
      localStorage.setItem("pi-multi-agent:last-session-id", restored.id);
      setCurrentMode(restored.mode || "auto");
      setPlan(restoredPlan);
      setSubTasks(restoredTasks);
      setAgents(restoredTasks.map((task, index) => ({
        id: task.id || `task-${index}`,
        name: task.assignedAgentName || `Agent ${index + 1}`,
        description: task.title,
        capabilities: [task.assignedAgentType || "agent"],
        tools: task.tools || [],
        assignedTask: task.title,
        priority: task.priority,
        state: restored.status === "completed" ? "completed" : restored.status === "failed" || isInterrupted ? "failed" : "idle",
      })));
      setFinalOutput(output);
      setStats({
        totalTasks: restoredTasks.length || (restored.workflowResult ? 1 : 0),
        completedTasks: restored.result?.progress?.filter((item) => item.status === "completed").length || (restored.status === "completed" ? restoredTasks.length : 0),
        failedTasks: restored.result?.progress?.filter((item) => item.status === "failed").length || (restored.status === "failed" || isInterrupted ? 1 : 0),
        runningTasks: restored.status === "running" && active ? 1 : 0,
        totalTokens: restored.result?.totalTokensUsed || restored.workflowResult?.totalTokens || 0,
        executionTime: restored.result?.totalExecutionTime || restored.workflowResult?.totalExecutionTime || 0,
        evaluationScore: restored.result?.evaluationScore || restored.evaluationScore || 0,
        iterations: restored.result?.iterations || restored.iterations || 1,
        finalOutputLength: output.length || restored.finalOutputLength || 0,
      });
      setExecutionPhase(isInterrupted ? "failed" : restored.status === "running" ? "executing" : restored.status);
      setRightTab(output ? "report" : restoredPlan ? "plan" : "stats");
      setIsExecuting(restored.status === "running" && active);
      setEvaluationResult(null);
      setWorkflowPhases([]);
      setWorkflowMeta(restored.mode === "workflow" ? { name: "Workflow", description: restored.task || "" } : null);
      setWorkflowCurrentPhase("");
      setWorkflowAgentMap(new Map());

      const restoredMessages: ChatMessage[] = [];
      if (restored.task) {
        restoredMessages.push({ id: `restore-user-${restored.id}`, type: "user", text: restored.task, timestamp: restored.createdAt });
      }
      restoredMessages.push({
        id: `restore-state-${restored.id}`,
        type: "system",
        text: getRestoreMessage({ status: restored.status, active }),
        timestamp: restored.updatedAt,
      });
      if (restored.error && !output) {
        restoredMessages.push({ id: `restore-error-${restored.id}`, type: "system", text: `Error: ${restored.error}`, timestamp: restored.updatedAt });
      }
      if (output) {
        restoredMessages.push({
          id: `restore-result-${restored.id}`,
          type: "result",
          text: output,
          timestamp: restored.updatedAt,
          resultData: {
            content: output,
            length: output.length,
            tokens: restored.result?.totalTokensUsed || restored.workflowResult?.totalTokens || 0,
            mode: restored.mode || "restored",
            agentCount: restoredTasks.length || 1,
          },
        });
      }
      setMessages(restoredMessages);

      if (active && restored.status === "running") {
        connectWS(restored.id);
      }
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        { id: `restore-error-${Date.now()}`, type: "system", text: `Failed to restore session: ${error.message}`, timestamp: Date.now() },
      ]);
    } finally {
      setRestoringSessionId("");
      await loadRecentSessions();
    }
  }, [connectWS, loadRecentSessions]);

  useEffect(() => {
    loadRecentSessions();
    const lastSessionId = localStorage.getItem("pi-multi-agent:last-session-id");
    if (lastSessionId) {
      restoreSession(lastSessionId);
    }
  }, [loadRecentSessions, restoreSession]);

  const createSession = async (): Promise<string> => {
    const res = await fetch(`${API_BASE}/api/sessions`, { method: "POST" });
    const data = await res.json();
    setSessionId(data.sessionId);
    localStorage.setItem("pi-multi-agent:last-session-id", data.sessionId);
    connectWS(data.sessionId);
    await loadRecentSessions();
    return data.sessionId;
  };

  const executeDeepTask = async (
    taskParam?: string,
    existingSessionId?: string,
    options: { appendUserMessage?: boolean; maxAgents?: number } = {}
  ) => {
    const task = taskParam || taskInput.trim();
    if (!task || isExecuting) return;

    if (!taskParam) setTaskInput("");
    const shouldAppendUserMessage = options.appendUserMessage ?? !taskParam;
    setAgents([]);
    setPlan(null);
    setSubTasks([]);
    setStats(null);
    setFinalOutput("");
    setEvaluationResult(null);
    setExecutionPhase("planning");

    setMessages((prev) => [
      ...prev,
      ...(shouldAppendUserMessage
        ? [{ id: `user-${Date.now()}`, type: "user" as const, text: task, timestamp: Date.now() }]
        : []),
      { id: `sys-${Date.now()}`, type: "system", text: "Initializing deep execution pipeline...", timestamp: Date.now() },
    ]);

    const sid = existingSessionId || await createSession();
    setIsExecuting(true);

    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sid}/cluster-execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task,
          targetWordCount: 30000,
          maxAgents: options.maxAgents || 10,
          maxIterations: 3,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const output = data.finalOutput || "";
        setFinalOutput(output);
        setStats({
          totalTasks: data.progress?.length || subTasks.length || 0,
          completedTasks: data.progress?.filter((p: any) => p.status === "completed").length || subTasks.filter((t) => t.status === "completed").length || 0,
          failedTasks: data.progress?.filter((p: any) => p.status === "failed").length || 0,
          runningTasks: 0,
          totalTokens: data.totalTokensUsed || 0,
          executionTime: data.totalExecutionTime || 0,
          evaluationScore: data.evaluationScore || 0,
          iterations: data.iterations || 1,
          finalOutputLength: output.length || 0,
        });

        if (data.progress) {
          setSubTasks((prev) =>
            prev.map((t) => {
              const p = data.progress.find((pp: any) => pp.taskId === t.id);
              if (p) {
                return {
                  ...t,
                  status: p.status,
                  progress: p.progress,
                  outputLength: p.outputLength,
                  error: p.error,
                };
              }
              return { ...t, status: "completed" as const, progress: 100 };
            })
          );
        }

        setExecutionPhase("completed");
        setRightTab("report");
        setMessages((prev) => [
          ...prev,
          {
            id: `result-${Date.now()}`,
            type: "result",
            text: output,
            timestamp: Date.now(),
            resultData: { content: output, length: output.length, tokens: data.totalTokensUsed || 0, mode: "deep", agentCount: data.progress?.length || options.maxAgents || 1 },
          },
        ]);
      } else {
        setExecutionPhase("failed");
        setMessages((prev) => [
          ...prev,
          { id: `sys-err-${Date.now()}`, type: "system", text: `Execution failed: ${data.error || "Unknown error"}`, timestamp: Date.now() },
        ]);
      }
    } catch (error: any) {
      setExecutionPhase("failed");
      setMessages((prev) => [
        ...prev,
        { id: `sys-${Date.now()}`, type: "system", text: `Error: ${error.message}`, timestamp: Date.now() },
      ]);
    }

    setIsExecuting(false);
    await loadRecentSessions();
  };

  const executeWorkflowTask = async (task: string, sid: string) => {
    setIsExecuting(true);
    setExecutionPhase("planning");
    setWorkflowPhases([]);
    setWorkflowMeta(null);
    setWorkflowCurrentPhase("");
    setWorkflowAgentMap(new Map());

    setMessages((prev) => [
      ...prev,
      { id: `sys-${Date.now()}`, type: "system", text: "Generating dynamic workflow script...", timestamp: Date.now() },
    ]);

    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sid}/workflow-execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task,
          tokenBudget: 200000,
          maxConcurrentAgents: 5,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const output = typeof data.output === "string" ? data.output : JSON.stringify(data.output, null, 2);
        setFinalOutput(output);

        if (data.snapshot) {
          finalizeWorkflowState(data.snapshot, data.totalTokens, data.totalExecutionTime);
        } else {
          setExecutionPhase("completed");
          setRightTab("report");
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `result-${Date.now()}`,
            type: "result",
            text: output,
            timestamp: Date.now(),
            resultData: { content: output, length: output.length, tokens: data.totalTokens || 0, mode: "workflow", agentCount: data.snapshot?.agents?.length || 1 },
          },
        ]);
      } else {
        setExecutionPhase("failed");
        setMessages((prev) => [
          ...prev,
          { id: `sys-err-${Date.now()}`, type: "system", text: `Workflow failed: ${data.error || "Unknown error"}`, timestamp: Date.now() },
        ]);
      }
    } catch (error: any) {
      setExecutionPhase("failed");
      setMessages((prev) => [
        ...prev,
        { id: `sys-${Date.now()}`, type: "system", text: `Error: ${error.message}`, timestamp: Date.now() },
      ]);
    }

    setIsExecuting(false);
    await loadRecentSessions();
  };

  const executeSimpleTask = async () => {
    const task = taskInput.trim();
    if (!task || isExecuting) return;

    setTaskInput("");
    setExecutionPhase("executing");

    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, type: "user", text: task, timestamp: Date.now() },
    ]);

    const sid = await createSession();
    setIsExecuting(true);

    setMessages((prev) => [
      ...prev,
      { id: `sys-${Date.now()}`, type: "system", text: "Analyzing task and generating agents...", timestamp: Date.now() },
    ]);

    const genRes = await fetch(`${API_BASE}/api/sessions/${sid}/agents/auto-generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task }),
    });
    const genData = await genRes.json();

    if (genData.agents) {
      setAgents(genData.agents);
      setMessages((prev) => [
        ...prev,
        { id: `sys-${Date.now()}`, type: "system", text: `Generated ${genData.agents.length} agents! Mode: ${genData.collaborationMode}`, timestamp: Date.now() },
      ]);
    }

    const agentIds = genData.agents?.map((a: AgentInfo) => a.id) || [];
    const res = await fetch(`${API_BASE}/api/sessions/${sid}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, mode: genData.collaborationMode || "sequential", agentIds }),
    });

    await res.json();
    setIsExecuting(false);
    setExecutionPhase("completed");
  };

  const executeCollaborationTask = async () => {
    const task = taskInput.trim();
    if (!task || isExecuting) return;

    setTaskInput("");
    setAgents([]);
    setPlan(null);
    setSubTasks([]);
    setStats(null);
    setFinalOutput("");
    setEvaluationResult(null);
    setExecutionPhase("executing");

    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, type: "user", text: task, timestamp: Date.now() },
      { id: `sys-${Date.now()}`, type: "system", text: `Starting ${currentMode} collaboration...`, timestamp: Date.now() },
    ]);

    const sid = await createSession();
    setIsExecuting(true);

    const modeAgentMap: Record<string, Array<{ id: string; name: string; type: string; systemPrompt: string; specialty: string }>> = {
      sequential: [
        { id: "researcher", name: "Researcher", type: "researcher", systemPrompt: "You are a senior research analyst. Gather comprehensive information and provide data-driven insights.", specialty: "research" },
        { id: "analyst", name: "Analyst", type: "analyst", systemPrompt: "You are a quantitative data analyst. Analyze data, identify patterns, and provide statistical insights.", specialty: "analysis" },
        { id: "writer", name: "Writer", type: "writer", systemPrompt: "You are a professional report writer. Synthesize research and analysis into clear, well-structured reports.", specialty: "writing" },
      ],
      parallel: [
        { id: "market_researcher", name: "Market Researcher", type: "researcher", systemPrompt: "You specialize in market research and industry analysis.", specialty: "market research" },
        { id: "tech_analyst", name: "Tech Analyst", type: "analyst", systemPrompt: "You specialize in technology trend analysis.", specialty: "technology analysis" },
        { id: "strategy_advisor", name: "Strategy Advisor", type: "advisor", systemPrompt: "You specialize in strategic recommendations and business planning.", specialty: "strategy" },
      ],
      expert_team: [
        { id: "domain_expert", name: "Domain Expert", type: "expert", systemPrompt: "You are a domain expert with deep knowledge in the relevant field.", specialty: "domain expertise" },
        { id: "data_scientist", name: "Data Scientist", type: "analyst", systemPrompt: "You are a data scientist specializing in quantitative analysis.", specialty: "data science" },
        { id: "senior_writer", name: "Senior Writer", type: "writer", systemPrompt: "You are a senior writer who produces professional, publication-ready content.", specialty: "professional writing" },
      ],
    };

    const agents = modeAgentMap[currentMode] || modeAgentMap.sequential;

    setAgents(agents.map((a, i) => ({
      id: a.id,
      name: a.name,
      description: a.specialty,
      capabilities: [a.type],
      state: "idle",
    })));

    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sid}/collaborate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: currentMode, task, agents }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        let errorMsg = `HTTP ${res.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMsg = errorJson.error || errorMsg;
        } catch {
          errorMsg = errorText || errorMsg;
        }
        throw new Error(errorMsg);
      }

      const data = await res.json();

      if (data.success) {
        const output = data.finalOutput || "";
        setFinalOutput(output);
        setExecutionPhase("completed");
        setRightTab("report");
        setStats({
          totalTasks: data.agentResults?.length || agents.length,
          completedTasks: data.agentResults?.filter((r: any) => r.success).length || agents.length,
          failedTasks: data.agentResults?.filter((r: any) => !r.success).length || 0,
          runningTasks: 0,
          totalTokens: data.totalTokens || 0,
          executionTime: data.totalExecutionTime || 0,
          evaluationScore: 0.8,
          iterations: data.iterations || 1,
          finalOutputLength: output.length,
        });
        setAgents((prev) => prev.map((a) => ({ ...a, state: "completed" })));
        setMessages((prev) => [
          ...prev,
          {
            id: `sys-done-${Date.now()}`,
            type: "system",
            text: `Collaboration complete: ${currentMode} mode | ${output.length.toLocaleString()} chars | ${data.totalTokens?.toLocaleString() || 0} tokens`,
            timestamp: Date.now(),
          },
        ]);
      } else {
        setExecutionPhase("failed");
        setMessages((prev) => [
          ...prev,
          { id: `sys-err-${Date.now()}`, type: "system", text: `Collaboration failed: ${data.error || "Unknown error"}`, timestamp: Date.now() },
        ]);
      }
    } catch (error: any) {
      setExecutionPhase("failed");
      setMessages((prev) => [
        ...prev,
        { id: `sys-err-${Date.now()}`, type: "system", text: `Error: ${error.message}`, timestamp: Date.now() },
      ]);
    }

    setIsExecuting(false);
    await loadRecentSessions();
  };

  const executeDirectTask = async (task: string, _sid: string) => {
    setIsExecuting(true);
    setExecutionPhase("executing");
    setAgents([{ id: "assistant", name: "Assistant", description: "AI Assistant", capabilities: ["general"], state: "running" }]);

    setMessages((prev) => [
      ...prev,
      { id: `sys-${Date.now()}`, type: "system", text: "Processing with single agent...", timestamp: Date.now() },
    ]);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: task }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        let errorMsg = `HTTP ${res.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMsg = errorJson.error || errorMsg;
        } catch {
          errorMsg = errorText || errorMsg;
        }
        throw new Error(errorMsg);
      }

      const data = await res.json();
      const output = data.output || "Task completed.";

      setFinalOutput(output);
      setExecutionPhase("completed");
      setRightTab("report");
      setAgents([{ id: "assistant", name: "Assistant", description: "AI Assistant", capabilities: ["general"], state: "completed" }]);
      setStats({
        totalTasks: 1,
        completedTasks: 1,
        failedTasks: 0,
        runningTasks: 0,
        totalTokens: data.tokens || 0,
        executionTime: 0,
        evaluationScore: 0,
        iterations: 1,
        finalOutputLength: output.length,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `result-${Date.now()}`,
          type: "result",
          text: output,
          timestamp: Date.now(),
          resultData: { content: output, length: output.length, tokens: data.tokens || 0, mode: "direct", agentCount: 1 },
        },
      ]);
    } catch (error: any) {
      setExecutionPhase("failed");
      setMessages((prev) => [
        ...prev,
        { id: `sys-err-${Date.now()}`, type: "system", text: `Error: ${error.message}`, timestamp: Date.now() },
      ]);
    }

    setIsExecuting(false);
  };

  const [pendingClarification, setPendingClarification] = useState<{ task: string; sid: string; hilData: HumanInLoopMessage } | null>(null);
  const [clarificationForm, setClarificationForm] = useState<Record<string, any>>({});

  const handleClarificationSubmit = () => {
    if (!pendingClarification) return;

    const { task, sid, hilData } = pendingClarification;
    const extras: string[] = [];
    if (hilData.uiSchema?.fields) {
      for (const field of hilData.uiSchema.fields) {
        const val = clarificationForm[field.key];
        if (val !== undefined && val !== "") {
          extras.push(`${field.label}: ${val}`);
        }
      }
    }

    const enrichedTask = extras.length > 0 ? `${task}\n\n补充信息:\n${extras.join("\n")}` : task;

    setPendingClarification(null);
    setClarificationForm({});

    setMessages((prev) => [
      ...prev,
      {
        id: `sys-clarify-done-${Date.now()}`,
        type: "system",
        text: extras.length > 0 ? `用户补充: ${extras.join("; ")}` : "用户跳过补充",
        timestamp: Date.now(),
      },
    ]);

    proceedWithAnalysis(enrichedTask, sid);
  };

  const handleClarificationCancel = () => {
    if (!pendingClarification) return;
    const { task, sid } = pendingClarification;
    setPendingClarification(null);
    setClarificationForm({});
    proceedWithAnalysis(task, sid);
  };

  const proceedWithAnalysis = async (task: string, sid: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `sys-${Date.now()}`, type: "system", text: "Analyzing task complexity...", timestamp: Date.now() },
    ]);

    try {
      const analysisRes = await fetch(`${API_BASE}/api/analyze-complexity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });

      if (!analysisRes.ok) {
        throw new Error("Complexity analysis failed");
      }

      const analysis = await analysisRes.json();

      setMessages((prev) => [
        ...prev,
        {
          id: `sys-analysis-${Date.now()}`,
          type: "system",
          text: `Complexity: ${analysis.level} | Agents: ${analysis.agentCount} | Mode: ${analysis.mode} — ${analysis.reasoning}`,
          timestamp: Date.now(),
        },
      ]);

      const execution = resolveAutoExecution(analysis);

      if (execution.kind === "direct") {
        await executeDirectTask(task, sid);
      } else if (execution.kind === "deep") {
        setCurrentMode("deep");
        await executeDeepTask(task, sid, {
          appendUserMessage: false,
          maxAgents: execution.agentCount,
        });
      } else {
        setCurrentMode(execution.mode);
        await executeCollaborationWithConfig(task, sid, execution.mode, execution.agentCount);
      }
    } catch (error: any) {
      await executeDirectTask(task, sid);
    }
  };

  const executeTask = async () => {
    const task = taskInput.trim();
    if (!task || isExecuting) return;

    setTaskInput("");
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, type: "user", text: task, timestamp: Date.now() },
    ]);

    const sid = await createSession();

    if (currentMode === "deep") {
      executeDeepTask(task, sid, { appendUserMessage: false });
      return;
    }

    if (currentMode === "workflow") {
      executeWorkflowTask(task, sid);
      return;
    }

    setMessages((prev) => [
      ...prev,
      { id: `sys-${Date.now()}`, type: "system", text: "Checking if clarification is needed...", timestamp: Date.now() },
    ]);

    try {
      const clarifyRes = await fetch(`${API_BASE}/api/clarify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });

      if (!clarifyRes.ok) {
        throw new Error("Clarification check failed");
      }

      const clarifyData = await clarifyRes.json();

      if (clarifyData.needsClarification && clarifyData.clarification) {
        const hilData: HumanInLoopMessage = {
          taskId: clarifyData.clarification.taskId || `task-${Date.now()}`,
          stepId: clarifyData.clarification.stepId || "clarify-1",
          status: "WAITING_INPUT",
          uiSchema: clarifyData.clarification.uiSchema,
          contextHint: clarifyData.clarification.contextHint,
          defaultValues: clarifyData.clarification.defaultValues,
        };

        setPendingClarification({ task, sid, hilData });
        setClarificationForm(hilData.defaultValues || {});

        setMessages((prev) => [
          ...prev,
          {
            id: `hil-${Date.now()}`,
            type: "human_input",
            text: clarifyData.reason || "Please provide additional information",
            timestamp: Date.now(),
            hilData,
          },
        ]);
        return;
      }
    } catch {
      // fallback: skip clarification
    }

    await proceedWithAnalysis(task, sid);
  };

  const executeCollaborationWithConfig = async (task: string, sid: string, mode: string, agentCount: number) => {
    setAgents([]);
    setPlan(null);
    setSubTasks([]);
    setStats(null);
    setFinalOutput("");
    setEvaluationResult(null);
    setExecutionPhase("executing");
    setIsExecuting(true);

    const allAgentPool = [
      { id: "researcher", name: "Researcher", type: "researcher", systemPrompt: "You are a senior research analyst. Gather comprehensive information and provide data-driven insights.", specialty: "research" },
      { id: "analyst", name: "Analyst", type: "analyst", systemPrompt: "You are a quantitative data analyst. Analyze data, identify patterns, and provide statistical insights.", specialty: "analysis" },
      { id: "writer", name: "Writer", type: "writer", systemPrompt: "You are a professional report writer. Synthesize research and analysis into clear, well-structured reports.", specialty: "writing" },
      { id: "market_researcher", name: "Market Researcher", type: "researcher", systemPrompt: "You specialize in market research and industry analysis.", specialty: "market research" },
      { id: "tech_analyst", name: "Tech Analyst", type: "analyst", systemPrompt: "You specialize in technology trend analysis.", specialty: "technology analysis" },
      { id: "strategy_advisor", name: "Strategy Advisor", type: "advisor", systemPrompt: "You specialize in strategic recommendations and business planning.", specialty: "strategy" },
      { id: "domain_expert", name: "Domain Expert", type: "expert", systemPrompt: "You are a domain expert with deep knowledge in the relevant field.", specialty: "domain expertise" },
      { id: "data_scientist", name: "Data Scientist", type: "analyst", systemPrompt: "You are a data scientist specializing in quantitative analysis.", specialty: "data science" },
      { id: "senior_writer", name: "Senior Writer", type: "writer", systemPrompt: "You are a senior writer who produces professional, publication-ready content.", specialty: "professional writing" },
      { id: "critic", name: "Critic", type: "critic", systemPrompt: "You are a critical reviewer who identifies gaps and improves quality.", specialty: "quality review" },
    ];

    const selectedAgents = allAgentPool.slice(0, Math.min(agentCount, allAgentPool.length));

    setAgents(selectedAgents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.specialty,
      capabilities: [a.type],
      state: "idle",
    })));

    setMessages((prev) => [
      ...prev,
      { id: `sys-${Date.now()}`, type: "system", text: `Starting ${mode} collaboration with ${selectedAgents.length} agents...`, timestamp: Date.now() },
    ]);

    try {
      const res = await fetch(`${API_BASE}/api/sessions/${sid}/collaborate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, task, agents: selectedAgents }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        let errorMsg = `HTTP ${res.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMsg = errorJson.error || errorMsg;
        } catch {
          errorMsg = errorText || errorMsg;
        }
        throw new Error(errorMsg);
      }

      const data = await res.json();

      if (data.success) {
        const output = data.finalOutput || "";
        setFinalOutput(output);
        setExecutionPhase("completed");
        setRightTab("report");
        setStats({
          totalTasks: data.agentResults?.length || selectedAgents.length,
          completedTasks: data.agentResults?.filter((r: any) => r.success).length || selectedAgents.length,
          failedTasks: data.agentResults?.filter((r: any) => !r.success).length || 0,
          runningTasks: 0,
          totalTokens: data.totalTokens || 0,
          executionTime: data.totalExecutionTime || 0,
          evaluationScore: 0.8,
          iterations: data.iterations || 1,
          finalOutputLength: output.length,
        });
        setAgents((prev) => prev.map((a) => ({ ...a, state: "completed" })));
        setMessages((prev) => [
          ...prev,
          {
            id: `result-${Date.now()}`,
            type: "result",
            text: output,
            timestamp: Date.now(),
            resultData: { content: output, length: output.length, tokens: data.totalTokens || 0, mode, agentCount: selectedAgents.length },
          },
        ]);
      } else {
        setExecutionPhase("failed");
        setMessages((prev) => [
          ...prev,
          { id: `sys-err-${Date.now()}`, type: "system", text: `Collaboration failed: ${data.error || "Unknown error"}`, timestamp: Date.now() },
        ]);
      }
    } catch (error: any) {
      setExecutionPhase("failed");
      setMessages((prev) => [
        ...prev,
        { id: `sys-err-${Date.now()}`, type: "system", text: `Error: ${error.message}`, timestamp: Date.now() },
      ]);
    }

    setIsExecuting(false);
  };

  const toggleTaskExpand = (taskId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const downloadReport = (format: string = "markdown") => {
    if (!finalOutput) return;

    if (format === "markdown") {
      const blob = new Blob([finalOutput], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pi-report-${Date.now()}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === "html") {
      const htmlContent = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Pi Multi-Agent Report</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.8;color:#1a1a1a}
h1{font-size:1.8em;border-bottom:2px solid #e5e7eb;padding-bottom:0.3em}
h2{font-size:1.4em;border-bottom:1px solid #e5e7eb;padding-bottom:0.2em;margin-top:2em}
h3{font-size:1.15em;margin-top:1.5em}
p{margin:0.8em 0}
ul,ol{padding-left:1.5em}
li{margin:0.3em 0}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid #d1d5db;padding:8px 12px;text-align:left}
th{background:#f3f4f6;font-weight:600}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:0.9em}
pre{background:#1e293b;color:#e2e8f0;padding:16px;border-radius:8px;overflow-x:auto}
pre code{background:transparent;padding:0;color:inherit}
blockquote{border-left:4px solid #6366f1;padding-left:1em;margin:1em 0;color:#4b5563}
</style></head><body>${markdownToHtml(finalOutput)}</body></html>`;
      const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pi-report-${Date.now()}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (format === "txt") {
      const blob = new Blob([finalOutput], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pi-report-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const markdownToHtml = (md: string): string => {
    let html = md;
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
    html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");
    html = html.replace(/\n{2,}/g, "</p><p>");
    html = `<p>${html}</p>`;
    html = html.replace(/<p><\/p>/g, "");
    html = html.replace(/<p>(<h[1-3]>)/g, "$1");
    html = html.replace(/(<\/h[1-3]>)<\/p>/g, "$1");
    html = html.replace(/<p>(<ul>)/g, "$1");
    html = html.replace(/(<\/ul>)<\/p>/g, "$1");
    html = html.replace(/<p>(<blockquote>)/g, "$1");
    html = html.replace(/(<\/blockquote>)<\/p>/g, "$1");
    return html;
  };

  const getStateIcon = (state?: string) => {
    switch (state) {
      case "running": return <Loader2 className="h-3 w-3 animate-spin text-blue-500" />;
      case "completed": return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
      case "error": case "failed": return <XCircle className="h-3 w-3 text-destructive" />;
      default: return <Circle className="h-3 w-3 text-muted-foreground" />;
    }
  };

  const getTaskStatusIcon = (status?: string) => {
    switch (status) {
      case "running": return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case "completed": return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "failed": return <XCircle className="h-4 w-4 text-destructive" />;
      case "retrying": return <RefreshCw className="h-4 w-4 text-amber-500 animate-spin" />;
      default: return <Circle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const formatSessionTime = (ts: number) => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}min`;
  };

  const completedCount = subTasks.filter((t) => t.status === "completed").length;
  const totalCount = subTasks.length;
  const overallProgress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Left Sidebar - Agent Team */}
      <div className="w-72 border-r bg-card flex flex-col shrink-0 h-screen">
        <div className="p-4 border-b shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4" />
              Agent Cluster
            </h2>
            <Badge variant="secondary" className="text-xs">{agents.length}</Badge>
          </div>
          {executionPhase !== "idle" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">{completedCount}/{totalCount}</span>
              </div>
              <Progress value={overallProgress} className="h-2" />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-3 border-b">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <History className="h-3.5 w-3.5" />
                Threads
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={loadRecentSessions} disabled={isLoadingSessions}>
                <RefreshCw className={`h-3 w-3 ${isLoadingSessions ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <div className="space-y-1 max-h-44 overflow-y-auto">
              {recentSessions.length === 0 ? (
                <div className="text-xs text-muted-foreground px-1 py-2">
                  No saved threads
                </div>
              ) : (
                recentSessions.slice(0, 8).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    title={item.task || item.id}
                    disabled={Boolean(restoringSessionId)}
                    onClick={() => restoreSession(item.id)}
                    className={`w-full text-left rounded-md px-2 py-2 transition-colors hover:bg-muted disabled:opacity-60 ${
                      sessionId === item.id ? "bg-muted" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate">{item.task || "Untitled thread"}</span>
                      <Badge
                        variant={item.status === "failed" ? "destructive" : item.status === "completed" ? "default" : "secondary"}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {item.status}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span>{formatSessionTime(item.updatedAt)}</span>
                      <span>{item.mode || "session"} · {item.finalOutputLength.toLocaleString()} chars</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="p-3 space-y-2">
            {agents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Bot className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No agents yet</p>
                <p className="text-xs mt-1">Enter a task to auto-generate</p>
              </div>
            ) : (
              agents.map((agent, i) => (
                <Card key={agent.id} className="py-0 gap-0">
                  <CardContent className="p-3">
                    <div className="flex items-start gap-2.5">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className={`${AGENT_COLORS[i % AGENT_COLORS.length]} text-white text-xs`}>
                          {getAgentInitial(agent.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{agent.name}</span>
                          {getStateIcon(agent.state)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {agent.assignedTask || agent.description}
                        </p>
                        <div className="flex items-center gap-1 mt-1.5">
                          {agent.priority && (
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${PRIORITY_COLORS[agent.priority] || ""}`}>
                              {agent.priority}
                            </Badge>
                          )}
                          {agent.tools?.slice(0, 2).map((tool) => (
                            <Badge key={tool} variant="secondary" className="text-[10px] px-1.5 py-0">
                              <Wrench className="h-2.5 w-2.5 mr-0.5" />
                              {tool.replace("_", " ")}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>

        <div className="p-3 border-t shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Radio className={`h-3 w-3 ${wsConnected ? "text-emerald-500" : "text-destructive"}`} />
            {wsConnected ? "Connected" : "Disconnected"}
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen">
        {/* Header */}
        <div className="h-14 border-b flex items-center justify-between px-4 bg-card shrink-0">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            <h1 className="text-sm font-semibold">Pi Multi-Agent</h1>
            {executionPhase !== "idle" && (
              <Badge
                variant={executionPhase === "completed" ? "default" : executionPhase === "failed" ? "destructive" : "secondary"}
                className="text-xs"
              >
                {executionPhase === "planning" && "Planning..."}
                {executionPhase === "executing" && "Executing..."}
                {executionPhase === "evaluating" && "Evaluating..."}
                {executionPhase === "completed" && "Completed"}
                {executionPhase === "failed" && "Failed"}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-muted rounded-md p-0.5">
              {[
                { key: "auto", label: "Auto" },
                { key: "deep", label: "Deep" },
                { key: "workflow", label: "Workflow" },
                { key: "sequential", label: "Sequential" },
                { key: "parallel", label: "Parallel" },
                { key: "expert_team", label: "Expert" },
              ].map((mode) => (
                <button
                  key={mode.key}
                  className={`px-2.5 py-1 text-xs rounded-sm transition-colors ${
                    currentMode === mode.key
                      ? "bg-background shadow-sm font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setCurrentMode(mode.key)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <Separator orientation="vertical" className="h-5" />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => clearWorkspace(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Messages - scrollable area */}
        <div className="flex-1 overflow-y-auto" id="chat-scroll-container">
          <div className="max-w-3xl mx-auto p-6 space-y-4">
            {messages.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-muted mb-4">
                  <Zap className="h-8 w-8" />
                </div>
                <h3 className="text-lg font-medium mb-2">Pi Multi-Agent Deep Execution</h3>
                <p className="text-sm max-w-md mx-auto leading-relaxed">
                  Describe your task. The system will create a deep plan, spawn an agent cluster (up to 10 agents),
                  execute subtasks in parallel, evaluate quality, and iterate until the output meets professional standards.
                </p>
                <div className="mt-6 grid grid-cols-3 gap-3 max-w-sm mx-auto text-xs">
                  <div className="p-3 rounded-lg bg-muted">
                    <Target className="h-5 w-5 mx-auto mb-1.5 text-primary" />
                    <div className="font-medium">Deep Plan</div>
                    <div className="text-muted-foreground mt-0.5">LLM-driven task decomposition</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <Users className="h-5 w-5 mx-auto mb-1.5 text-primary" />
                    <div className="font-medium">Agent Cluster</div>
                    <div className="text-muted-foreground mt-0.5">10+ agents parallel execution</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted">
                    <BarChart3 className="h-5 w-5 mx-auto mb-1.5 text-primary" />
                    <div className="font-medium">Quality Loop</div>
                    <div className="text-muted-foreground mt-0.5">Evaluate & iterate until pass</div>
                  </div>
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id}>
                  {msg.type === "user" ? (
                    <div className="flex justify-end">
                      <div className="max-w-[80%]">
                        <div className="flex items-center justify-end gap-2 mb-1">
                          <span className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</span>
                          <span className="text-xs font-medium">You</span>
                        </div>
                        <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-2.5 text-sm">
                          {msg.text}
                        </div>
                      </div>
                    </div>
                  ) : msg.type === "tool_call" ? (
                    <div className="flex gap-3">
                      <Avatar className="h-7 w-7 mt-0.5">
                        <AvatarFallback className={`${msg.agentId ? getAgentColor(msg.agentId) : "bg-violet-500"} text-white text-[10px]`}>
                          {msg.agentName ? getAgentInitial(msg.agentName) : "AI"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="max-w-[80%]">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium">{msg.agentName}</span>
                          <span className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</span>
                        </div>
                        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl rounded-tl-md px-3 py-2">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-400">
                            <Wrench className="h-3 w-3" />
                            Calling: {msg.toolCall}
                          </div>
                          {msg.toolInput && Object.keys(msg.toolInput).length > 0 && (
                            <div className="mt-1.5 text-[10px] text-blue-600/70 dark:text-blue-400/70 font-mono bg-blue-100/50 dark:bg-blue-900/30 rounded px-2 py-1 max-h-20 overflow-y-auto">
                              {JSON.stringify(msg.toolInput, null, 2).substring(0, 300)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : msg.type === "tool_result" ? (
                    <div className="flex gap-3">
                      <div className="w-7 shrink-0" />
                      <div className="max-w-[80%]">
                        <div className={`${msg.toolSuccess ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800" : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"} border rounded-xl px-3 py-2`}>
                          <div className={`flex items-center gap-1.5 text-xs font-medium ${msg.toolSuccess ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                            {msg.toolSuccess ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                            {msg.toolResult} {msg.toolDuration && `(${msg.toolDuration}ms)`}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : msg.type === "evaluation" ? (
                    <div className="flex justify-center">
                      <div className="bg-gradient-to-r from-violet-50 to-blue-50 dark:from-violet-950/30 dark:to-blue-950/30 border border-violet-200 dark:border-violet-800 rounded-xl px-4 py-3 max-w-[90%]">
                        <div className="flex items-center gap-2 mb-2">
                          <BarChart3 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                          <span className="text-xs font-semibold text-violet-700 dark:text-violet-400">Quality Evaluation</span>
                          <span className="text-lg font-bold text-violet-700 dark:text-violet-400">
                            {((msg.evaluationData?.score ?? 0) * 100)?.toFixed(0) || "N/A"}%
                          </span>
                        </div>
                        {msg.evaluationData?.dimensions && msg.evaluationData.dimensions.length > 0 && (
                          <div className="grid grid-cols-2 gap-1.5 mb-2">
                            {msg.evaluationData.dimensions.map((dim) => (
                              <div key={dim.name} className="flex items-center gap-1.5 text-[10px]">
                                {dim.passed ? (
                                  <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                                ) : (
                                  <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                                )}
                                <span className="capitalize text-muted-foreground">{dim.name}</span>
                                <span className="font-medium ml-auto">{dim.score}%</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {msg.evaluationData?.strengths && msg.evaluationData.strengths.length > 0 && (
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400">
                            Strengths: {msg.evaluationData.strengths.slice(0, 2).join("; ")}
                          </div>
                        )}
                        {msg.evaluationData?.weaknesses && msg.evaluationData.weaknesses.length > 0 && (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                            Issues: {msg.evaluationData.weaknesses.slice(0, 2).join("; ")}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : msg.type === "result" ? (
                    <div className="flex gap-3">
                      <Avatar className="h-8 w-8 mt-0.5">
                        <AvatarFallback className="bg-emerald-500 text-white text-xs">AI</AvatarFallback>
                      </Avatar>
                      <div className="max-w-[85%] min-w-[60%]">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium">Pi Agent</span>
                          <span className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</span>
                          {msg.resultData && (
                            <span className="text-[10px] text-muted-foreground">
                              {msg.resultData.mode} · {msg.resultData.agentCount} agent{msg.resultData.agentCount > 1 ? "s" : ""} · {msg.resultData.tokens.toLocaleString()} tokens
                            </span>
                          )}
                        </div>
                        {msg.resultData && msg.resultData.length > 500 ? (
                          <div className="border rounded-xl rounded-tl-md overflow-hidden">
                            <div className="bg-muted/50 px-4 py-3 text-sm leading-relaxed max-h-40 overflow-hidden relative">
                              <div className="whitespace-pre-wrap">{msg.resultData.content.substring(0, 300)}...</div>
                              <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-muted/50 to-transparent" />
                            </div>
                            <div className="px-4 py-2.5 bg-muted/30 border-t flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">
                                {msg.resultData.length.toLocaleString()} chars · Full report in Report panel
                              </span>
                              <div className="flex items-center gap-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs gap-1"
                                  onClick={() => {
                                    setRightTab("report");
                                    const reportTab = document.querySelector('[data-tab="report"]') as HTMLElement;
                                    if (reportTab) reportTab.click();
                                  }}
                                >
                                  <FileText className="h-3 w-3" />
                                  View Report
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs gap-1"
                                  onClick={() => downloadReport("markdown")}
                                >
                                  <Download className="h-3 w-3" />
                                  MD
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs gap-1"
                                  onClick={() => downloadReport("html")}
                                >
                                  <Download className="h-3 w-3" />
                                  HTML
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs gap-1"
                                  onClick={() => downloadReport("txt")}
                                >
                                  <Download className="h-3 w-3" />
                                  TXT
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="bg-muted rounded-2xl rounded-tl-md px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed">
                              {msg.text}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] gap-1 text-muted-foreground"
                                onClick={() => downloadReport("markdown")}
                              >
                                <Download className="h-2.5 w-2.5" />
                                MD
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] gap-1 text-muted-foreground"
                                onClick={() => downloadReport("html")}
                              >
                                <Download className="h-2.5 w-2.5" />
                                HTML
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 text-[10px] gap-1 text-muted-foreground"
                                onClick={() => downloadReport("txt")}
                              >
                                <Download className="h-2.5 w-2.5" />
                                TXT
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : msg.type === "human_input" && msg.hilData ? (
                    <div className="flex gap-3">
                      <Avatar className="h-8 w-8 mt-0.5">
                        <AvatarFallback className="bg-amber-500 text-white text-xs">?</AvatarFallback>
                      </Avatar>
                      <div className="max-w-[85%] min-w-[50%]">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium">Pi Agent</span>
                          <span className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 rounded-full font-medium">Needs Input</span>
                        </div>
                        <div className="border border-amber-200 dark:border-amber-800 rounded-xl rounded-tl-md overflow-hidden">
                          {msg.hilData.contextHint && (
                            <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800">
                              <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                                <MessageCircle className="h-3 w-3" />
                                {msg.hilData.contextHint}
                              </div>
                            </div>
                          )}
                          {msg.hilData.uiSchema && (
                            <div className="p-4">
                              {msg.hilData.uiSchema.title && (
                                <div className="text-sm font-semibold mb-1">{msg.hilData.uiSchema.title}</div>
                              )}
                              {msg.hilData.uiSchema.description && (
                                <div className="text-xs text-muted-foreground mb-3">{msg.hilData.uiSchema.description}</div>
                              )}
                              <div className="space-y-3">
                                {msg.hilData.uiSchema.fields?.map((field) => (
                                  <div key={field.key}>
                                    <label className="text-xs font-medium mb-1 block">
                                      {field.label}
                                      {field.required && <span className="text-red-500 ml-0.5">*</span>}
                                    </label>
                                    {field.type === "select" && field.options ? (
                                      <select
                                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                                        value={clarificationForm[field.key] || ""}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setClarificationForm((prev) => ({ ...prev, [field.key]: val }));
                                        }}
                                      >
                                        <option value="">请选择...</option>
                                        {field.options.map((opt) => (
                                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                      </select>
                                    ) : field.type === "textarea" ? (
                                      <textarea
                                        className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                                        placeholder={field.placeholder || ""}
                                        value={clarificationForm[field.key] || ""}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setClarificationForm((prev) => ({ ...prev, [field.key]: val }));
                                        }}
                                      />
                                    ) : (
                                      <input
                                        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                                        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                                        placeholder={field.placeholder || ""}
                                        value={clarificationForm[field.key] || ""}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setClarificationForm((prev) => ({ ...prev, [field.key]: val }));
                                        }}
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                              <div className="flex items-center gap-2 mt-4 pt-3 border-t">
                                {msg.hilData.uiSchema.actions?.map((action) => (
                                  <Button
                                    key={action.key}
                                    variant={action.variant === "primary" ? "default" : action.variant === "danger" ? "destructive" : "outline"}
                                    size="sm"
                                    className="h-8 text-xs"
                                    onClick={() => {
                                      if (action.submit) {
                                        handleClarificationSubmit();
                                      } else if (action.key === "cancel" || action.variant === "danger") {
                                        handleClarificationCancel();
                                      }
                                    }}
                                  >
                                    {action.label}
                                  </Button>
                                ))}
                                {!msg.hilData.uiSchema.actions && (
                                  <>
                                    <Button variant="default" size="sm" className="h-8 text-xs" onClick={handleClarificationSubmit}>
                                      确认提交
                                    </Button>
                                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleClarificationCancel}>
                                      跳过
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : msg.type === "system" ? (
                    <div className="flex justify-center">
                      <div className="bg-muted rounded-full px-4 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5">
                        {msg.toolCall && <Wrench className="h-3 w-3" />}
                        {msg.text}
                      </div>
                    </div>
                  ) : msg.thinking ? (
                    <div className="flex gap-3">
                      <Avatar className="h-8 w-8 mt-0.5">
                        <AvatarFallback className={`${msg.agentId ? getAgentColor(msg.agentId) : "bg-violet-500"} text-white text-xs`}>
                          {msg.agentName ? getAgentInitial(msg.agentName) : "AI"}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium">{msg.agentName}</span>
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        </div>
                        <div className="bg-muted rounded-2xl rounded-tl-md px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.3s]" />
                            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.15s]" />
                            <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <Avatar className="h-8 w-8 mt-0.5">
                        <AvatarFallback className={`${msg.agentId ? getAgentColor(msg.agentId) : "bg-violet-500"} text-white text-xs`}>
                          {msg.agentName ? getAgentInitial(msg.agentName) : "AI"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="max-w-[80%]">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium">{msg.agentName}</span>
                          <span className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</span>
                        </div>
                        <div className="bg-muted rounded-2xl rounded-tl-md px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed">
                          {msg.text}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input - fixed at bottom */}
        <div className="border-t p-4 bg-card shrink-0">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-2">
              <div className="flex-1">
                <Textarea
                  value={taskInput}
                  onChange={(e) => setTaskInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      executeTask();
                    }
                  }}
                  placeholder="Describe your complex task... (e.g., 完成一份3万字的2025年中国AI市场深度调研报告)"
                  disabled={isExecuting}
                  className="min-h-[44px] max-h-[120px] resize-none"
                  rows={1}
                />
              </div>
              <Button onClick={executeTask} disabled={!taskInput.trim() || isExecuting} className="self-end">
                {isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            {currentMode === "auto" && (
              <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                Auto: AI analyzes task complexity and automatically selects the optimal agent count and collaboration mode
              </p>
            )}
            {currentMode === "deep" && (
              <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                Deep mode: LLM planning → Agent cluster (up to 10) → Parallel execution → Quality evaluation → Iteration → 30,000+ word report
              </p>
            )}
            {currentMode === "workflow" && (
              <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                Workflow: LLM auto-generates a workflow script → VM sandbox orchestrates agents with parallel/pipeline → Structured output
              </p>
            )}
            {currentMode === "sequential" && (
              <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                Sequential: Researcher → Analyst → Writer pipeline, each agent builds on the previous output
              </p>
            )}
            {currentMode === "parallel" && (
              <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                Parallel: All agents work simultaneously on different perspectives, then synthesize
              </p>
            )}
            {currentMode === "expert_team" && (
              <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                Expert Team: Domain specialists collaborate with an integrator for comprehensive output
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div className="w-96 border-l bg-card flex flex-col shrink-0 h-screen">
        <Tabs value={rightTab} onValueChange={setRightTab} className="flex flex-col h-full">
          <TabsList className="w-full rounded-none border-b h-10 bg-transparent p-0 shrink-0">
            <TabsTrigger value="plan" className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none text-xs">
              <Target className="h-3 w-3 mr-1" />
              Plan
            </TabsTrigger>
            <TabsTrigger value="workflow" className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none text-xs">
              <Zap className="h-3 w-3 mr-1" />
              Flow
            </TabsTrigger>
            <TabsTrigger value="tasks" className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none text-xs">
              <Activity className="h-3 w-3 mr-1" />
              Tasks
            </TabsTrigger>
            <TabsTrigger value="stats" className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none text-xs">
              <BarChart3 className="h-3 w-3 mr-1" />
              Stats
            </TabsTrigger>
            <TabsTrigger value="report" className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none text-xs">
              <FileText className="h-3 w-3 mr-1" />
              Report
            </TabsTrigger>
          </TabsList>

          {/* Plan Tab */}
          <TabsContent value="plan" className="flex-1 mt-0 overflow-y-auto min-h-0">
            <div className="p-4 space-y-4">
              {!plan ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Target className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No plan yet</p>
                  <p className="text-xs mt-1">Submit a task in Deep mode to generate a plan</p>
                </div>
              ) : (
                <>
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Goal</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{plan.goal}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded-md bg-muted">
                      <div className="text-[10px] text-muted-foreground">Mode</div>
                      <div className="text-xs font-medium">{plan.collaborationMode}</div>
                    </div>
                    <div className="p-2 rounded-md bg-muted">
                      <div className="text-[10px] text-muted-foreground">Tasks</div>
                      <div className="text-xs font-medium">{plan.subTaskCount}</div>
                    </div>
                    <div className="p-2 rounded-md bg-muted">
                      <div className="text-[10px] text-muted-foreground">Structure</div>
                      <div className="text-xs font-medium">{plan.communicationStructure || "supervisor"}</div>
                    </div>
                    <div className="p-2 rounded-md bg-muted">
                      <div className="text-[10px] text-muted-foreground">Target</div>
                      <div className="text-xs font-medium">{plan.qualityThresholds?.minWordCount?.toLocaleString() || "30,000"} words</div>
                    </div>
                  </div>

                  {plan.executionStrategy && (
                    <div>
                      <h3 className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">Strategy</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">{plan.executionStrategy}</p>
                    </div>
                  )}

                  {plan.successCriteria && plan.successCriteria.length > 0 && (
                    <div>
                      <h3 className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">Success Criteria</h3>
                      <ul className="space-y-1">
                        {plan.successCriteria.map((c, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                            <CheckCircle2 className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <Separator />

                  <div>
                    <h3 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Subtask Pipeline</h3>
                    <div className="space-y-1.5">
                      {subTasks.map((task, i) => (
                        <div key={task.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                          <div className="shrink-0">{getTaskStatusIcon(task.status)}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">{task.title}</div>
                            <div className="text-[10px] text-muted-foreground">{task.assignedAgentName}</div>
                          </div>
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${PRIORITY_COLORS[task.priority] || ""}`}>
                            {task.priority}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          {/* Workflow Flow Tab */}
          <TabsContent value="workflow" className="flex-1 mt-0 overflow-y-auto min-h-0">
            <div className="p-4 space-y-4">
              {workflowPhases.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Zap className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No workflow yet</p>
                  <p className="text-xs mt-1">Use Workflow mode to see the execution flow</p>
                </div>
              ) : (
                <>
                  {workflowMeta && (
                    <div className="p-3 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800">
                      <div className="flex items-center gap-2 mb-1">
                        <Zap className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                        <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">{workflowMeta.name}</span>
                      </div>
                      <p className="text-xs text-violet-600/80 dark:text-violet-400/80">{workflowMeta.description}</p>
                    </div>
                  )}

                  <div className="space-y-0">
                    {workflowPhases.map((phase, pi) => {
                      const isLast = pi === workflowPhases.length - 1;
                      const completedAgents = phase.agents.filter((a) => a.status === "completed" || a.status === "skipped").length;
                      const totalAgents = phase.agents.length;
                      const phaseProgress = totalAgents > 0 ? (completedAgents / totalAgents) * 100 : 0;

                      return (
                        <div key={pi}>
                          <div className={`p-3 rounded-lg border ${
                            phase.status === "running"
                              ? "border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/20"
                              : phase.status === "completed"
                              ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/10"
                              : phase.status === "failed"
                              ? "border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/10"
                              : "border-border bg-muted/30"
                          }`}>
                            <div className="flex items-center gap-2 mb-2">
                              <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                phase.status === "running"
                                  ? "bg-blue-500 text-white animate-pulse"
                                  : phase.status === "completed"
                                  ? "bg-emerald-500 text-white"
                                  : phase.status === "failed"
                                  ? "bg-red-500 text-white"
                                  : "bg-muted text-muted-foreground"
                              }`}>
                                {phase.status === "completed" ? "✓" : phase.status === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> : pi + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium truncate">{phase.title}</span>
                                  {phase.status === "running" && (
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                                      Running
                                    </Badge>
                                  )}
                                </div>
                                {totalAgents > 0 && (
                                  <div className="flex items-center gap-2 mt-1">
                                    <Progress value={phaseProgress} className="flex-1 h-1.5" />
                                    <span className="text-[10px] text-muted-foreground">{completedAgents}/{totalAgents}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {phase.agents.length > 0 && (
                              <div className="ml-8 space-y-1.5 mt-2">
                                {phase.agents.map((agent) => (
                                  <div key={agent.id} className={`flex items-center gap-2 p-2 rounded-md text-xs ${
                                    agent.status === "running"
                                      ? "bg-blue-100/50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                                      : agent.status === "completed"
                                      ? "bg-emerald-50 dark:bg-emerald-950/10"
                                      : agent.status === "failed"
                                      ? "bg-red-50 dark:bg-red-950/10"
                                      : "bg-muted/50"
                                  }`}>
                                    <div className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
                                      agent.status === "running"
                                        ? "bg-blue-500 text-white"
                                        : agent.status === "completed"
                                        ? "bg-emerald-500 text-white"
                                        : agent.status === "failed"
                                        ? "bg-red-500 text-white"
                                        : "bg-muted text-muted-foreground"
                                    }`}>
                                      {agent.status === "running" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> :
                                       agent.status === "completed" ? <CheckCircle2 className="h-2.5 w-2.5" /> :
                                       agent.status === "failed" ? <XCircle className="h-2.5 w-2.5" /> :
                                       <Circle className="h-2.5 w-2.5" />}
                                    </div>
                                    <span className="font-medium truncate flex-1">{agent.label}</span>
                                    {agent.status === "running" && (
                                      <span className="text-[10px] text-blue-600 dark:text-blue-400 animate-pulse">executing...</span>
                                    )}
                                    {agent.status === "completed" && agent.outputLength !== undefined && (
                                      <span className="text-[10px] text-muted-foreground">{agent.outputLength.toLocaleString()} chars</span>
                                    )}
                                    {agent.status === "failed" && agent.error && (
                                      <span className="text-[10px] text-red-600 dark:text-red-400 truncate max-w-[100px]">{agent.error}</span>
                                    )}
                                    {agent.startedAt && (
                                      <span className="text-[10px] text-muted-foreground">
                                        {agent.completedAt ? formatDuration(agent.completedAt - agent.startedAt) : "running..."}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {!isLast && (
                            <div className="flex justify-center py-1">
                              <div className={`w-0.5 h-4 ${
                                phase.status === "completed" ? "bg-emerald-300 dark:bg-emerald-700" : "bg-border"
                              }`} />
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {workflowPhases.length > 0 && workflowPhases.every((p) => p.status === "completed") && (
                      <div className="flex justify-center py-2">
                        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">All phases merged — Workflow complete</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <Separator />

                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 rounded-md bg-muted text-center">
                      <div className="text-lg font-bold">{workflowPhases.length}</div>
                      <div className="text-[10px] text-muted-foreground">Phases</div>
                    </div>
                    <div className="p-2 rounded-md bg-muted text-center">
                      <div className="text-lg font-bold">{workflowPhases.reduce((sum, p) => sum + p.agents.length, 0)}</div>
                      <div className="text-[10px] text-muted-foreground">Agents</div>
                    </div>
                    <div className="p-2 rounded-md bg-muted text-center">
                      <div className="text-lg font-bold text-emerald-600">
                        {workflowPhases.reduce((sum, p) => sum + p.agents.filter((a) => a.status === "completed").length, 0)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">Completed</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          {/* Tasks Tab */}
          <TabsContent value="tasks" className="flex-1 mt-0 overflow-y-auto min-h-0">
            <div className="p-4 space-y-2">
              {subTasks.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No tasks yet</p>
                </div>
              ) : (
                subTasks.map((task) => (
                  <Card key={task.id} className="py-0 gap-0">
                    <CardContent className="p-3">
                      <div
                        className="flex items-center gap-2 cursor-pointer"
                        onClick={() => toggleTaskExpand(task.id)}
                      >
                        {expandedTasks.has(task.id) ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        {getTaskStatusIcon(task.status)}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{task.title}</div>
                        </div>
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${PRIORITY_COLORS[task.priority] || ""}`}>
                          {task.priority}
                        </Badge>
                      </div>

                      {expandedTasks.has(task.id) && (
                        <div className="mt-3 space-y-2 pl-6">
                          <div>
                            <span className="text-[10px] text-muted-foreground">Agent:</span>
                            <span className="text-xs ml-1">{task.assignedAgentName} ({task.assignedAgentType})</span>
                          </div>
                          {task.description && (
                            <div>
                              <span className="text-[10px] text-muted-foreground">Description:</span>
                              <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
                            </div>
                          )}
                          {task.expectedOutput && (
                            <div>
                              <span className="text-[10px] text-muted-foreground">Expected:</span>
                              <p className="text-xs text-muted-foreground mt-0.5">{task.expectedOutput}</p>
                            </div>
                          )}
                          <div>
                            <span className="text-[10px] text-muted-foreground">Tools:</span>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {task.tools.map((tool) => (
                                <Badge key={tool} variant="secondary" className="text-[10px] px-1.5 py-0">
                                  <Wrench className="h-2.5 w-2.5 mr-0.5" />
                                  {tool.replace("_", " ")}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          {task.dependencies.length > 0 && (
                            <div>
                              <span className="text-[10px] text-muted-foreground">Dependencies:</span>
                              <span className="text-xs ml-1">{task.dependencies.join(", ")}</span>
                            </div>
                          )}
                          {task.outputLength !== undefined && (
                            <div>
                              <span className="text-[10px] text-muted-foreground">Output:</span>
                              <span className="text-xs ml-1">{task.outputLength.toLocaleString()} chars</span>
                            </div>
                          )}
                          {task.error && (
                            <div className="text-xs text-destructive">Error: {task.error}</div>
                          )}
                          {task.startTime && (
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Clock className="h-2.5 w-2.5" />
                              {formatTime(task.startTime)}
                              {task.endTime && ` → ${formatTime(task.endTime)} (${formatDuration(task.endTime - task.startTime)})`}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* Stats Tab */}
          <TabsContent value="stats" className="flex-1 mt-0 overflow-y-auto min-h-0">
            <div className="p-4 space-y-4">
              {!stats ? (
                <div className="text-center py-12 text-muted-foreground">
                  <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No stats yet</p>
                  <p className="text-xs mt-1">Execute a task to see statistics</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-[10px] text-muted-foreground mb-1">Total Tasks</div>
                      <div className="text-lg font-bold">{stats.totalTasks}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-[10px] text-muted-foreground mb-1">Completed</div>
                      <div className="text-lg font-bold text-emerald-600">{stats.completedTasks}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-[10px] text-muted-foreground mb-1">Failed</div>
                      <div className="text-lg font-bold text-destructive">{stats.failedTasks}</div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-[10px] text-muted-foreground mb-1">Iterations</div>
                      <div className="text-lg font-bold">{stats.iterations}</div>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-muted">
                    <div className="text-[10px] text-muted-foreground mb-1">Evaluation Score</div>
                    <div className="flex items-center gap-2">
                      <div className="text-2xl font-bold">{(stats.evaluationScore * 100).toFixed(0)}%</div>
                      <Progress value={stats.evaluationScore * 100} className="flex-1 h-2" />
                    </div>
                  </div>

                  {evaluationResult?.dimensions && evaluationResult.dimensions.length > 0 && (
                    <div className="p-3 rounded-lg bg-muted">
                      <div className="text-[10px] text-muted-foreground mb-2">Evaluation Dimensions</div>
                      <div className="space-y-2">
                        {evaluationResult.dimensions.map((dim) => (
                          <div key={dim.name}>
                            <div className="flex items-center justify-between text-xs mb-0.5">
                              <span className="capitalize font-medium flex items-center gap-1">
                                {dim.passed ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
                                {dim.name}
                              </span>
                              <span className="text-muted-foreground">{dim.score}%</span>
                            </div>
                            <Progress value={dim.score} className="h-1.5" />
                            {dim.feedback && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">{dim.feedback}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {evaluationResult?.strengths && evaluationResult.strengths.length > 0 && (
                    <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20">
                      <div className="text-[10px] text-emerald-700 dark:text-emerald-400 mb-1">Strengths</div>
                      <ul className="space-y-0.5">
                        {evaluationResult.strengths.map((s, i) => (
                          <li key={i} className="text-xs text-emerald-600 dark:text-emerald-400 flex items-start gap-1">
                            <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {evaluationResult?.weaknesses && evaluationResult.weaknesses.length > 0 && (
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20">
                      <div className="text-[10px] text-amber-700 dark:text-amber-400 mb-1">Weaknesses</div>
                      <ul className="space-y-0.5">
                        {evaluationResult.weaknesses.map((w, i) => (
                          <li key={i} className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1">
                            <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                            {w}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="p-3 rounded-lg bg-muted">
                    <div className="text-[10px] text-muted-foreground mb-1">Execution Time</div>
                    <div className="text-lg font-bold">{formatDuration(stats.executionTime)}</div>
                  </div>

                  <div className="p-3 rounded-lg bg-muted">
                    <div className="text-[10px] text-muted-foreground mb-1">Total Tokens</div>
                    <div className="text-lg font-bold">{stats.totalTokens.toLocaleString()}</div>
                  </div>

                  <div className="p-3 rounded-lg bg-muted">
                    <div className="text-[10px] text-muted-foreground mb-1">Report Length</div>
                    <div className="text-lg font-bold">{stats.finalOutputLength.toLocaleString()} chars</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      ~{Math.round(stats.finalOutputLength / 2).toLocaleString()} words (Chinese)
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-muted">
                    <div className="text-[10px] text-muted-foreground mb-2">Task Completion</div>
                    {subTasks.map((task) => (
                      <div key={task.id} className="flex items-center gap-2 mb-1.5">
                        {getTaskStatusIcon(task.status)}
                        <span className="text-xs flex-1 truncate">{task.title}</span>
                        {task.outputLength !== undefined && (
                          <span className="text-[10px] text-muted-foreground">{task.outputLength.toLocaleString()}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          {/* Report Tab */}
          <TabsContent value="report" className="flex-1 mt-0 overflow-y-auto min-h-0">
            <div className="p-4 space-y-3">
              {!finalOutput ? (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No report yet</p>
                  <p className="text-xs mt-1">Execute a Deep task to generate a report</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Final Report</h3>
                    <div className="flex items-center gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => downloadReport("markdown")}>
                        <Download className="h-3 w-3 mr-1" />
                        .md
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => downloadReport("html")}>
                        <Download className="h-3 w-3 mr-1" />
                        .html
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => downloadReport("txt")}>
                        <Download className="h-3 w-3 mr-1" />
                        .txt
                      </Button>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {finalOutput.length.toLocaleString()} characters | ~{Math.round(finalOutput.length / 2).toLocaleString()} words
                  </div>
                  <Separator />
                  <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed whitespace-pre-wrap">
                    {finalOutput}
                  </div>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
