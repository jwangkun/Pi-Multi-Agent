export type AgentId = string;
export type TaskId = string;
export type SessionId = string;
export type MessageId = string;

export interface ModelConfig {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  timeout?: number;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema?: TInput;
  outputSchema?: TOutput;
  execute: (input: TInput, context: ToolExecutionContext) => Promise<TOutput>;
}

export interface ToolExecutionContext {
  agentId: AgentId;
  sessionId: SessionId;
  taskId: TaskId;
  metadata: Record<string, unknown>;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: AgentError;
  metadata?: {
    executionTime: number;
    tokenUsage?: TokenUsage;
  };
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AgentConfig {
  id?: string;
  name: string;
  description?: string;
  systemPrompt: string;
  model: ModelConfig;
  tools?: ToolDefinition[];
  maxRetries?: number;
  timeout?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
}

export type AgentState = 
  | 'idle'
  | 'initializing'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentContext {
  sessionId: SessionId;
  taskId: TaskId;
  parentAgentId?: AgentId;
  rootAgentId?: AgentId;
  depth: number;
  iteration: number;
  startTime: number;
  metadata: Record<string, unknown>;
}

export interface AgentMetrics {
  totalInvocations: number;
  successfulInvocations: number;
  failedInvocations: number;
  averageExecutionTime: number;
  totalTokenUsage: TokenUsage;
  lastInvocationTime?: number;
}

export interface AgentStats {
  state: AgentState;
  metrics: AgentMetrics;
  currentTask?: string;
  error?: AgentError;
}

export interface AgentCapability {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  returns?: unknown;
}

export interface AgentProfile {
  id: AgentId;
  name: string;
  description: string;
  capabilities: AgentCapability[];
  tools: string[];
  specialties: string[];
  collaborationMode: CollaborationPattern;
}

export enum CollaborationPattern {
  SequentialHandoffs = 'sequential_handoffs',
  ParallelProcessing = 'parallel_processing',
  DebateAndConsensus = 'debate_and_consensus',
  Hierarchical = 'hierarchical',
  ExpertTeam = 'expert_team',
  CriticReviewer = 'critic_reviewer',
}

export enum CommunicationStructure {
  SingleAgent = 'single_agent',
  Network = 'network',
  Supervisor = 'supervisor',
  SupervisorAsTool = 'supervisor_as_tool',
  Hierarchical = 'hierarchical',
  Custom = 'custom',
}

export interface Message<T = unknown> {
  id: MessageId;
  senderId: AgentId;
  receiverId?: AgentId;
  type: MessageType;
  content: T;
  timestamp: number;
  metadata?: MessageMetadata;
}

export type MessageType = 
  | 'request'
  | 'response'
  | 'task'
  | 'result'
  | 'error'
  | 'status'
  | 'handoff'
  | 'broadcast'
  | 'direct';

export interface MessageMetadata {
  correlationId?: string;
  replyTo?: MessageId;
  ttl?: number;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  tags?: string[];
}

export interface HandoffMessage<T = unknown> extends Message<T> {
  type: 'handoff';
  fromAgent: AgentId;
  toAgent: AgentId;
  task: Task<T>;
  context?: Partial<AgentContext>;
}

export interface BroadcastMessage<T = unknown> extends Message<T> {
  type: 'broadcast';
  excludedAgents?: AgentId[];
}

export interface Task<TInput = unknown, TOutput = unknown> {
  id: TaskId;
  type: string;
  description: string;
  input: TInput;
  output?: TOutput;
  status: TaskStatus;
  priority: TaskPriority;
  assignedAgent?: AgentId;
  dependencies: TaskId[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: AgentError;
  metadata?: Record<string, unknown>;
}

export type TaskStatus = 
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retrying';

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

export interface TaskResult<T = unknown> {
  taskId: TaskId;
  success: boolean;
  data?: T;
  error?: AgentError;
  executionTime: number;
  agentId: AgentId;
  metadata?: Record<string, unknown>;
}

export interface ExecutionPlan {
  id: string;
  taskId: TaskId;
  steps: ExecutionStep[];
  dependencies: Map<TaskId, TaskId[]>;
  estimatedDuration?: number;
  constraints?: PlanConstraints;
  createdAt: number;
  updatedAt: number;
}

export interface ExecutionStep {
  id: string;
  taskId: TaskId;
  agentId: AgentId;
  action: string;
  input: unknown;
  output?: unknown;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  dependencies: string[];
  estimatedTime?: number;
  actualTime?: number;
  retryCount: number;
  maxRetries: number;
  error?: AgentError;
}

export interface PlanConstraints {
  maxDuration?: number;
  maxTokens?: number;
  maxBudget?: number;
  requiredQuality?: number;
  deadlines?: Map<string, number>;
}

export interface EvaluationResult {
  passed: boolean;
  score: number;
  dimensions: EvaluationDimension[];
  feedback: string;
  suggestions?: string[];
  metadata?: Record<string, unknown>;
}

export interface EvaluationDimension {
  name: string;
  score: number;
  weight: number;
  description: string;
  passed: boolean;
}

export interface ReflectionResult {
  success: boolean;
  analysis: string;
  issues: Issue[];
  recommendations: Recommendation[];
  shouldRetry: boolean;
  newPlan?: ExecutionPlan;
}

export interface Issue {
  severity: 'critical' | 'major' | 'minor' | 'info';
  category: string;
  description: string;
  location?: string;
  suggestion?: string;
}

export interface Recommendation {
  priority: number;
  action: string;
  rationale: string;
  expectedImpact: string;
}

export interface RetryPolicy {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
  nonRetryableErrors?: string[];
}

export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
  halfOpenRequests: number;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  queueSize?: number;
}

export interface AgentError extends Error {
  code: string;
  agentId?: AgentId;
  taskId?: TaskId;
  recoverable: boolean;
  retryable: boolean;
  context?: Record<string, unknown>;
  cause?: Error;
}

export interface SystemConfig {
  debug: boolean;
  logLevel: LogLevel;
  enableMetrics: boolean;
  enableTracing: boolean;
  maxConcurrentAgents: number;
  defaultTimeout: number;
  defaultRetryPolicy: RetryPolicy;
  circuitBreaker: CircuitBreakerConfig;
  rateLimit: RateLimitConfig;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  agentId?: AgentId;
  taskId?: TaskId;
  sessionId?: SessionId;
}

export interface Trace {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'started' | 'running' | 'completed' | 'failed';
  metadata?: Record<string, unknown>;
  spans?: Trace[];
}

export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: ComponentHealth[];
  timestamp: number;
}

export interface ComponentHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  lastCheck?: number;
}

export interface MemoryEntry<T = unknown> {
  key: string;
  value: T;
  timestamp: number;
  ttl?: number;
  tags?: string[];
  source?: AgentId;
  accessCount: number;
}

export interface SessionContext {
  id: SessionId;
  userId?: string;
  createdAt: number;
  lastAccessedAt: number;
  metadata: Record<string, unknown>;
  shortTermMemory: Map<string, MemoryEntry>;
  longTermMemory?: Map<string, MemoryEntry>;
}

export interface SharedState {
  sessionId: SessionId;
  taskId: TaskId;
  agents: Map<AgentId, AgentStats>;
  tasks: Map<TaskId, Task>;
  sharedData: Map<string, unknown>;
  version: number;
  lastUpdate: number;
}

export type EventType = 
  | 'agent:created'
  | 'agent:started'
  | 'agent:completed'
  | 'agent:failed'
  | 'agent:error'
  | 'task:created'
  | 'task:assigned'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'task:retry'
  | 'message:sent'
  | 'message:received'
  | 'handoff:initiated'
  | 'handoff:completed'
  | 'evaluation:started'
  | 'evaluation:completed'
  | 'plan:created'
  | 'plan:updated'
  | 'plan:executed'
  | 'state:updated'
  | 'circuit:opened'
  | 'circuit:closed'
  | 'rate:limited';

export interface Event<T = unknown> {
  type: EventType;
  timestamp: number;
  source: AgentId | string;
  data: T;
  metadata?: Record<string, unknown>;
}
