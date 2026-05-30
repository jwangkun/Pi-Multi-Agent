import type { JSONSchema } from './structured-output.js';

export interface WorkflowPhase {
  title: string;
}

export interface WorkflowMeta {
  name: string;
  description: string;
  phases: WorkflowPhase[];
}

export interface AgentOpts {
  label?: string;
  schema?: JSONSchema;
  maxTokens?: number;
  temperature?: number;
}

export interface WorkflowSnapshot {
  meta: WorkflowMeta;
  currentPhase: string;
  agents: AgentSnapshot[];
  logs: string[];
  status: WorkflowStatus;
  startedAt: number;
  updatedAt: number;
}

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface AgentSnapshot {
  id: number;
  label: string;
  phase: string;
  status: AgentStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface WorkflowResult {
  success: boolean;
  output: unknown;
  snapshot: WorkflowSnapshot;
  totalTokens: number;
  totalExecutionTime: number;
}

export interface WorkflowConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
  maxTokens?: number;
  tokenBudget?: number;
  maxConcurrentAgents?: number;
  abortSignal?: AbortSignal;
}

export type WorkflowEventCallback = (event: WorkflowEvent) => void;

export type WorkflowEvent =
  | { type: 'workflow:started'; meta: WorkflowMeta; timestamp: number }
  | { type: 'phase:changed'; phase: string; timestamp: number }
  | { type: 'agent:started'; agentId: number; label: string; phase: string; timestamp: number }
  | { type: 'agent:completed'; agentId: number; label: string; outputLength: number; timestamp: number }
  | { type: 'agent:failed'; agentId: number; label: string; error: string; timestamp: number }
  | { type: 'agent:skipped'; agentId: number; label: string; reason: string; timestamp: number }
  | { type: 'workflow:log'; message: string; timestamp: number }
  | { type: 'workflow:completed'; result: WorkflowResult; timestamp: number }
  | { type: 'workflow:failed'; error: string; timestamp: number }
  | { type: 'workflow:cancelled'; timestamp: number };
