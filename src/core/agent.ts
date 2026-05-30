import {
  AgentConfig,
  AgentId,
  AgentState,
  AgentMetrics,
  AgentStats,
  AgentContext,
  Task,
  TaskId,
  SessionId,
  TaskResult,
  ToolDefinition,
  ToolResult,
  RetryPolicy,
  TokenUsage,
  Event,
  EventType,
} from './types.js';
import {
  AgentExecutionError,
  AgentTimeoutError,
  ToolExecutionError,
  PiAgentError,
  isRetryableError,
} from './errors.js';
import { MessageBus, MessageFactory } from './message.js';

let agentIdCounter = 0;

function generateAgentId(): AgentId {
  return `agent_${Date.now()}_${++agentIdCounter}` as AgentId;
}

export interface AgentExecutor {
  execute(
    prompt: string,
    context: AgentContext,
    tools?: ToolDefinition[]
  ): Promise<{ text: string; tokenUsage?: TokenUsage }>;
}

export interface AgentEventHandlers {
  onStateChange?: (agentId: AgentId, oldState: AgentState, newState: AgentState) => void;
  onTaskStart?: (agentId: AgentId, task: Task) => void;
  onTaskComplete?: (agentId: AgentId, result: TaskResult) => void;
  onTaskError?: (agentId: AgentId, error: PiAgentError) => void;
  onMessage?: (agentId: AgentId, event: Event) => void;
}

export class Agent {
  public readonly id: AgentId;
  public readonly name: string;
  public readonly description: string;
  public readonly systemPrompt: string;
  public readonly model: AgentConfig['model'];
  public readonly tools: ToolDefinition[];
  public readonly maxRetries: number;
  public readonly timeout: number;
  public readonly metadata: Record<string, unknown>;

  private state: AgentState = 'idle';
  private context?: AgentContext;
  private messageBus: MessageBus;
  private eventHandlers: AgentEventHandlers;
  private metrics: AgentMetrics;
  private currentTask?: Task;
  private executor?: AgentExecutor;
  private retryPolicy: RetryPolicy;

  constructor(
    config: AgentConfig,
    executor: AgentExecutor,
    options: {
      messageBus?: MessageBus;
      eventHandlers?: AgentEventHandlers;
      retryPolicy?: RetryPolicy;
    } = {}
  ) {
    this.id = generateAgentId();
    this.name = config.name;
    this.description = config.description ?? '';
    this.systemPrompt = config.systemPrompt;
    this.model = config.model;
    this.tools = config.tools ?? [];
    this.maxRetries = config.maxRetries ?? 3;
    this.timeout = config.timeout ?? 60000;
    this.metadata = config.metadata ?? {};
    this.executor = executor;
    this.messageBus = options.messageBus ?? new MessageBus();
    this.eventHandlers = options.eventHandlers ?? {};
    this.retryPolicy = options.retryPolicy ?? {
      maxRetries: this.maxRetries,
      initialDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
    };

    this.metrics = {
      totalInvocations: 0,
      successfulInvocations: 0,
      failedInvocations: 0,
      averageExecutionTime: 0,
      totalTokenUsage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    };
  }

  getState(): AgentState {
    return this.state;
  }

  getStats(): AgentStats {
    return {
      state: this.state,
      metrics: { ...this.metrics },
      currentTask: this.currentTask?.description,
      error: undefined,
    };
  }

  getMetrics(): AgentMetrics {
    return { ...this.metrics };
  }

  async initialize(context: AgentContext): Promise<void> {
    this.setState('initializing');
    this.context = context;
    await this.setupEventHandlers();
    this.setState('idle');
  }

  private async setupEventHandlers(): Promise<void> {
    this.messageBus.subscribe('task', async (message) => {
      if (message.receiverId === this.id) {
        await this.handleTask(message);
      }
    });

    this.messageBus.subscribe('handoff', async (message) => {
      if (message.receiverId === this.id) {
        await this.handleHandoff(message);
      }
    });
  }

  async execute(input: string, context?: Partial<AgentContext>): Promise<TaskResult> {
    const startTime = Date.now();
    this.setState('running');

    const executionContext: AgentContext = {
      sessionId: (context?.sessionId ?? this.context?.sessionId) as SessionId,
      taskId: (context?.taskId ?? `task_${Date.now()}`) as TaskId,
      parentAgentId: context?.parentAgentId ?? this.context?.parentAgentId,
      rootAgentId: context?.rootAgentId ?? this.context?.rootAgentId ?? this.id,
      depth: (context?.depth ?? 0) + 1,
      iteration: context?.iteration ?? 0,
      startTime: context?.startTime ?? startTime,
      metadata: {
        ...this.context?.metadata,
        ...context?.metadata,
        agentName: this.name,
      },
    };

    this.metrics.totalInvocations++;

    let lastError: PiAgentError | undefined;
    let retryCount = 0;

    while (retryCount <= this.retryPolicy.maxRetries) {
      try {
        const result = await this.executeWithTimeout(input, executionContext);
        const executionTime = Date.now() - startTime;
        this.updateMetrics(true, executionTime, result.tokenUsage);
        this.setState('completed');

        const taskResult = {
          taskId: executionContext.taskId,
          success: true,
          data: result,
          executionTime,
          agentId: this.id,
        } satisfies TaskResult;

        this.eventHandlers.onTaskComplete?.(this.id, taskResult);
        this.publishEvent('agent:completed', taskResult);

        return taskResult;
      } catch (error) {
        if (error instanceof PiAgentError) {
          lastError = error;
        } else {
          lastError = new AgentExecutionError(
            error instanceof Error ? error.message : String(error),
            { agentId: this.id, cause: error instanceof Error ? error : undefined }
          );
        }
        
        if (!isRetryableError(lastError) || retryCount >= this.retryPolicy.maxRetries) {
          break;
        }

        retryCount++;
        const delay = this.calculateRetryDelay(retryCount);
        await this.sleep(delay);
      }
    }

    const executionTime = Date.now() - startTime;
    this.updateMetrics(false, executionTime);
    this.setState('failed');

    this.eventHandlers.onTaskError?.(this.id, lastError!);
    this.publishEvent('agent:failed', { error: lastError });

    throw lastError;
  }

  private async executeWithTimeout(
    input: string,
    context: AgentContext
  ): Promise<{ text: string; tokenUsage?: TokenUsage }> {
    return Promise.race([
      this.executeInternal(input, context),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new AgentTimeoutError(`Agent ${this.name} timed out after ${this.timeout}ms`, {
            agentId: this.id,
          }));
        }, this.timeout);
      }),
    ]);
  }

  private async executeInternal(
    input: string,
    context: AgentContext
  ): Promise<{ text: string; tokenUsage?: TokenUsage }> {
    const fullPrompt = this.buildPrompt(input, context);
    
    if (!this.executor) {
      throw new AgentExecutionError('No executor configured for agent', { agentId: this.id });
    }

    return this.executor.execute(fullPrompt, context, this.tools);
  }

  private buildPrompt(input: string, context: AgentContext): string {
    let prompt = this.systemPrompt;
    
    if (context.metadata && Object.keys(context.metadata).length > 0) {
      prompt += `\n\n## Context\n${JSON.stringify(context.metadata, null, 2)}`;
    }
    
    prompt += `\n\n## Task\n${input}`;
    
    return prompt;
  }

  async executeTool<TInput, TOutput>(
    toolName: string,
    input: TInput
  ): Promise<ToolResult<TOutput>> {
    const startTime = Date.now();
    const tool = this.tools.find((t) => t.name === toolName);

    if (!tool) {
      throw new ToolExecutionError(`Tool not found: ${toolName}`, toolName, {
        agentId: this.id,
      });
    }

    try {
      const result = await tool.execute(input, {
        agentId: this.id,
        sessionId: this.context?.sessionId as SessionId,
        taskId: this.context?.taskId as TaskId,
        metadata: {},
      });

      return {
        success: true,
        data: result as TOutput,
        metadata: {
          executionTime: Date.now() - startTime,
        },
      };
    } catch (error) {
      const execError = error instanceof PiAgentError ? error : 
        new ToolExecutionError(
          error instanceof Error ? error.message : String(error),
          toolName,
          { agentId: this.id, cause: error instanceof Error ? error : undefined }
        );
      return {
        success: false,
        error: execError,
        metadata: {
          executionTime: Date.now() - startTime,
        },
      };
    }
  }

  private async handleTask(message: { content: unknown }): Promise<void> {
    const task = message.content as Task;
    this.currentTask = task;
    
    this.eventHandlers.onTaskStart?.(this.id, task);
    this.publishEvent('task:started', { task });

    try {
      await this.execute(task.description, {
        taskId: task.id,
        metadata: { originalTask: task },
      });
    } catch (error) {
      this.eventHandlers.onTaskError?.(
        this.id, 
        error instanceof PiAgentError ? error : new AgentExecutionError(
          error instanceof Error ? error.message : String(error),
          { agentId: this.id }
        )
      );
    }
  }

  private async handleHandoff(message: { content: unknown }): Promise<void> {
    this.publishEvent('handoff:initiated', { message });
    await this.handleTask(message);
    this.publishEvent('handoff:completed', { agentId: this.id });
  }

  private setState(newState: AgentState): void {
    const oldState = this.state;
    this.state = newState;
    
    if (oldState !== newState) {
      this.eventHandlers.onStateChange?.(this.id, oldState, newState);
      this.publishEvent('state:updated', { oldState, newState });
    }
  }

  private updateMetrics(success: boolean, executionTime: number, tokenUsage?: TokenUsage): void {
    if (success) {
      this.metrics.successfulInvocations++;
    } else {
      this.metrics.failedInvocations++;
    }

    const totalExecutions = this.metrics.totalInvocations;
    this.metrics.averageExecutionTime =
      (this.metrics.averageExecutionTime * (totalExecutions - 1) + executionTime) / totalExecutions;
    
    this.metrics.lastInvocationTime = Date.now();

    if (tokenUsage) {
      this.metrics.totalTokenUsage.promptTokens += tokenUsage.promptTokens;
      this.metrics.totalTokenUsage.completionTokens += tokenUsage.completionTokens;
      this.metrics.totalTokenUsage.totalTokens += tokenUsage.totalTokens;
    }
  }

  private calculateRetryDelay(retryCount: number): number {
    const delay = this.retryPolicy.initialDelay * Math.pow(this.retryPolicy.backoffMultiplier, retryCount - 1);
    return Math.min(delay, this.retryPolicy.maxDelay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private publishEvent(type: EventType, data: unknown): void {
    const event: Event = {
      type,
      timestamp: Date.now(),
      source: this.id,
      data,
    };

    const message = MessageFactory.create({
      senderId: this.id,
      type: 'status',
      content: event,
    });

    this.messageBus.publish(message).catch(() => {});
    this.eventHandlers.onMessage?.(this.id, event);
  }

  cancel(): void {
    if (this.state === 'running' || this.state === 'waiting') {
      this.setState('cancelled');
    }
  }

  reset(): void {
    this.state = 'idle';
    this.currentTask = undefined;
    this.metrics = {
      totalInvocations: 0,
      successfulInvocations: 0,
      failedInvocations: 0,
      averageExecutionTime: 0,
      totalTokenUsage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    };
  }
}

export function createAgentTool<TInput = unknown, TOutput = unknown>(
  definition: ToolDefinition<TInput, TOutput>
): ToolDefinition<TInput, TOutput> {
  return definition;
}
