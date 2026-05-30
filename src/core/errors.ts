import { AgentId, TaskId, AgentError as AgentErrorType } from './types.js';

export interface ErrorOptions {
  agentId?: AgentId;
  taskId?: TaskId;
  recoverable?: boolean;
  retryable?: boolean;
  context?: Record<string, unknown>;
  cause?: Error;
}

export class PiAgentError extends Error implements AgentErrorType {
  public readonly code: string;
  public readonly agentId?: AgentId;
  public readonly taskId?: TaskId;
  public readonly recoverable: boolean;
  public readonly retryable: boolean;
  public readonly context?: Record<string, unknown>;
  public override readonly cause?: Error;

  constructor(
    message: string,
    code: string,
    options: ErrorOptions = {}
  ) {
    super(message);
    this.name = 'PiAgentError';
    this.code = code;
    this.agentId = options.agentId;
    this.taskId = options.taskId;
    this.recoverable = options.recoverable ?? true;
    this.retryable = options.retryable ?? true;
    this.context = options.context;
    this.cause = options.cause;

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, PiAgentError);
    }
  }
}

export class AgentInitializationError extends PiAgentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'AGENT_INIT_ERROR', { ...options, recoverable: false });
    this.name = 'AgentInitializationError';
  }
}

export class AgentExecutionError extends PiAgentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'AGENT_EXECUTION_ERROR', options);
    this.name = 'AgentExecutionError';
  }
}

export class AgentTimeoutError extends PiAgentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'AGENT_TIMEOUT', { ...options, recoverable: true, retryable: false });
    this.name = 'AgentTimeoutError';
  }
}

export class AgentNotFoundError extends PiAgentError {
  constructor(agentId: AgentId | string, options?: ErrorOptions) {
    super(`Agent not found: ${agentId}`, 'AGENT_NOT_FOUND', { ...options, recoverable: false });
    this.name = 'AgentNotFoundError';
  }
}

export class TaskError extends PiAgentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'TASK_ERROR', options);
    this.name = 'TaskError';
  }
}

export class TaskNotFoundError extends PiAgentError {
  constructor(taskId: TaskId | string, options?: ErrorOptions) {
    super(`Task not found: ${taskId}`, 'TASK_NOT_FOUND', { ...options, recoverable: false });
    this.name = 'TaskNotFoundError';
  }
}

export class TaskDependencyError extends PiAgentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'TASK_DEPENDENCY_ERROR', { ...options, recoverable: true });
    this.name = 'TaskDependencyError';
  }
}

export class PlanningError extends PiAgentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'PLANNING_ERROR', { ...options, recoverable: true });
    this.name = 'PlanningError';
  }
}

export class OrchestrationError extends PiAgentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'ORCHESTRATION_ERROR', options);
    this.name = 'OrchestrationError';
  }
}

export class EvaluationError extends PiAgentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'EVALUATION_ERROR', options);
    this.name = 'EvaluationError';
  }
}

export class MemoryError extends PiAgentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'MEMORY_ERROR', options);
    this.name = 'MemoryError';
  }
}

export class CommunicationError extends PiAgentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'COMMUNICATION_ERROR', options);
    this.name = 'CommunicationError';
  }
}

export class HandoffError extends PiAgentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'HANDOFF_ERROR', { ...options, recoverable: true });
    this.name = 'HandoffError';
  }
}

export class ToolExecutionError extends PiAgentError {
  public readonly toolName?: string;

  constructor(message: string, toolName?: string, options?: ErrorOptions) {
    super(message, 'TOOL_EXECUTION_ERROR', options);
    this.name = 'ToolExecutionError';
    this.toolName = toolName;
  }
}

export class CircuitBreakerOpenError extends PiAgentError {
  public readonly circuitName: string;
  public readonly remainingTimeout: number;

  constructor(circuitName: string, remainingTimeout: number) {
    super(
      `Circuit breaker '${circuitName}' is open. Retry after ${remainingTimeout}ms`,
      'CIRCUIT_BREAKER_OPEN',
      { recoverable: true, retryable: true }
    );
    this.name = 'CircuitBreakerOpenError';
    this.circuitName = circuitName;
    this.remainingTimeout = remainingTimeout;
  }
}

export class RateLimitExceededError extends PiAgentError {
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message, 'RATE_LIMIT_EXCEEDED', { recoverable: true, retryable: true });
    this.name = 'RateLimitExceededError';
    this.retryAfter = retryAfter;
  }
}

export class ValidationError extends PiAgentError {
  public readonly validationErrors: Array<{ field: string; message: string }>;

  constructor(message: string, validationErrors: Array<{ field: string; message: string }> = []) {
    super(message, 'VALIDATION_ERROR', { recoverable: false, retryable: false });
    this.name = 'ValidationError';
    this.validationErrors = validationErrors;
  }
}

export class ConfigurationError extends PiAgentError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'CONFIGURATION_ERROR', { ...options, recoverable: false });
    this.name = 'ConfigurationError';
  }
}

export function isRetryableError(error: Error): boolean {
  if (error instanceof PiAgentError) {
    return error.retryable;
  }
  return true;
}

export function isRecoverableError(error: Error): boolean {
  if (error instanceof PiAgentError) {
    return error.recoverable;
  }
  return true;
}

export function getErrorCode(error: Error): string {
  if (error instanceof PiAgentError) {
    return error.code;
  }
  return 'UNKNOWN_ERROR';
}
