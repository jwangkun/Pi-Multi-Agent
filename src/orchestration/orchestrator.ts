import {
  Task,
  TaskId,
  TaskStatus,
  TaskPriority,
  ExecutionPlan,
  ExecutionStep,
  AgentId,
  AgentContext,
  SessionId,
  TaskResult,
  CommunicationStructure,
} from '../core/types.js';
import { OrchestrationError, AgentNotFoundError, PiAgentError } from '../core/errors.js';
import { Agent } from '../core/agent.js';
import { Planner } from './planner.js';

export interface OrchestratorConfig {
  maxConcurrentTasks?: number;
  taskTimeout?: number;
  enableAutoRecovery?: boolean;
  maxRetries?: number;
  communicationStructure?: CommunicationStructure;
}

export interface AgentRegistry {
  register(agent: Agent): void;
  unregister(agentId: AgentId): void;
  getAgent(agentId: AgentId): Agent | undefined;
  getAgentsByCapability(capability: string): Agent[];
  getAllAgents(): Agent[];
}

export class DefaultAgentRegistry implements AgentRegistry {
  private agents: Map<AgentId, Agent> = new Map();
  private capabilityIndex: Map<string, Set<AgentId>> = new Map();

  register(agent: Agent): void {
    this.agents.set(agent.id, agent);
    
    const capabilities = this.extractCapabilities(agent);
    for (const capability of capabilities) {
      if (!this.capabilityIndex.has(capability)) {
        this.capabilityIndex.set(capability, new Set());
      }
      this.capabilityIndex.get(capability)?.add(agent.id);
    }
  }

  unregister(agentId: AgentId): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      const capabilities = this.extractCapabilities(agent);
      for (const capability of capabilities) {
        this.capabilityIndex.get(capability)?.delete(agentId);
      }
      this.agents.delete(agentId);
    }
  }

  getAgent(agentId: AgentId): Agent | undefined {
    return this.agents.get(agentId);
  }

  getAgentsByCapability(capability: string): Agent[] {
    const agentIds = this.capabilityIndex.get(capability) ?? new Set();
    const agents: Agent[] = [];
    for (const id of agentIds) {
      const agent = this.agents.get(id);
      if (agent) {
        agents.push(agent);
      }
    }
    return agents;
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  private extractCapabilities(agent: Agent): string[] {
    const capabilities: string[] = [];
    
    if (agent.name.toLowerCase().includes('research')) {
      capabilities.push('research', 'search', 'information gathering');
    }
    if (agent.name.toLowerCase().includes('analyst')) {
      capabilities.push('analysis', 'analyze', 'data analysis');
    }
    if (agent.name.toLowerCase().includes('writer')) {
      capabilities.push('writing', 'create', 'content creation');
    }
    if (agent.name.toLowerCase().includes('editor')) {
      capabilities.push('editing', 'review', 'quality assurance');
    }
    
    return capabilities;
  }
}

export class Orchestrator {
  private config: Required<OrchestratorConfig>;
  private registry: AgentRegistry;
  private planner: Planner;
  private activeTasks: Map<TaskId, Task> = new Map();
  private taskQueue: Task[] = [];
  private context: AgentContext;

  constructor(
    config: OrchestratorConfig = {},
    registry?: AgentRegistry,
    planner?: Planner
  ) {
    this.config = {
      maxConcurrentTasks: config.maxConcurrentTasks ?? 5,
      taskTimeout: config.taskTimeout ?? 60000,
      enableAutoRecovery: config.enableAutoRecovery ?? true,
      maxRetries: config.maxRetries ?? 3,
      communicationStructure: config.communicationStructure ?? CommunicationStructure.Supervisor,
    };

    this.registry = registry ?? new DefaultAgentRegistry();
    this.planner = planner ?? new Planner();
    this.context = this.createInitialContext();
  }

  private createInitialContext(): AgentContext {
    return {
      sessionId: `session_${Date.now()}` as SessionId,
      taskId: `task_${Date.now()}` as TaskId,
      depth: 0,
      iteration: 0,
      startTime: Date.now(),
      metadata: {},
    };
  }

  getRegistry(): AgentRegistry {
    return this.registry;
  }

  getPlanner(): Planner {
    return this.planner;
  }

  registerAgent(agent: Agent): void {
    this.registry.register(agent);
  }

  unregisterAgent(agentId: AgentId): void {
    this.registry.unregister(agentId);
  }

  async executeGoal(goal: string, options?: { priority?: TaskPriority }): Promise<TaskResult[]> {
    const agents = this.registry.getAllAgents();
    
    if (agents.length === 0) {
      throw new OrchestrationError('No agents registered in the orchestrator');
    }

    const agentInfo = agents.map((a) => ({
      id: a.id,
      capabilities: this.extractCapabilities(a),
    }));

    const plan = await this.planner.createPlan(goal, agentInfo, this.context);

    const results = await this.executePlan(plan, options);

    return results;
  }

  private async executePlan(
    plan: ExecutionPlan,
    _options?: { priority?: TaskPriority }
  ): Promise<TaskResult[]> {
    const results: TaskResult[] = [];
    const context = this.createExecutionContext();

    while (!this.planner.isPlanComplete(plan)) {
      const executableSteps = this.planner.getExecutableSteps(plan);
      
      if (executableSteps.length === 0) {
        const pendingSteps = plan.steps.filter((s) => s.status === 'pending');
        if (pendingSteps.length > 0) {
          throw new OrchestrationError(
            `No executable steps available. ${pendingSteps.length} steps are blocked.`
          );
        }
        break;
      }

      const stepsToExecute = executableSteps.slice(0, this.config.maxConcurrentTasks);

      const promises = stepsToExecute.map((step) => 
        this.executeStep(step, plan, context)
      );

      const stepResults = await Promise.allSettled(promises);
      
      for (let i = 0; i < stepResults.length; i++) {
        const resultItem = stepResults[i] as PromiseSettledResult<TaskResult>;
        const step = stepsToExecute[i];
        if (!step) continue;

        if (resultItem.status === 'fulfilled') {
          results.push(resultItem.value);
          plan = this.planner.updateStepStatus(plan, step.id, 'completed');
        } else {
          const reason = resultItem.reason;
          if (step.retryCount < step.maxRetries && this.config.enableAutoRecovery) {
            plan = this.planner.updateStepStatus(plan, step.id, 'pending');
            step.retryCount++;
          } else {
            const taskError: PiAgentError = reason instanceof PiAgentError 
              ? reason 
              : new OrchestrationError(
                  reason instanceof Error ? reason.message : String(reason),
                  { agentId: step.agentId }
                );
            
            results.push({
              taskId: step.taskId,
              success: false,
              error: taskError,
              executionTime: 0,
              agentId: step.agentId,
            });
            plan = this.planner.updateStepStatus(plan, step.id, 'failed', taskError);
          }
        }
      }
    }

    return results;
  }

  private async executeStep(
    step: ExecutionStep,
    plan: ExecutionPlan,
    context: AgentContext
  ): Promise<TaskResult> {
    const agent = this.registry.getAgent(step.agentId);
    
    if (!agent) {
      throw new AgentNotFoundError(step.agentId);
    }

    const startTime = Date.now();

    try {
      this.planner.updateStepStatus(plan, step.id, 'running');

      const result = await agent.execute(step.action, {
        ...context,
        taskId: step.taskId,
      });

      return {
        ...result,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private createExecutionContext(): AgentContext {
    return {
      sessionId: `session_${Date.now()}` as SessionId,
      taskId: `task_${Date.now()}` as TaskId,
      rootAgentId: undefined,
      parentAgentId: undefined,
      depth: 0,
      iteration: 0,
      startTime: Date.now(),
      metadata: {
        orchestrator: true,
      },
    };
  }

  private extractCapabilities(agent: Agent): string[] {
    const capabilities: string[] = [];
    
    if (agent.name.toLowerCase().includes('research')) {
      capabilities.push('research', 'search');
    }
    if (agent.name.toLowerCase().includes('analyst')) {
      capabilities.push('analysis', 'analyze');
    }
    if (agent.name.toLowerCase().includes('writer')) {
      capabilities.push('writing', 'create');
    }
    if (agent.name.toLowerCase().includes('editor')) {
      capabilities.push('editing', 'review');
    }
    
    return capabilities;
  }

  async submitTask(task: Task): Promise<void> {
    this.taskQueue.push(task);
    this.activeTasks.set(task.id, task);
  }

  async cancelTask(taskId: TaskId): Promise<void> {
    const task = this.activeTasks.get(taskId);
    if (task) {
      task.status = 'cancelled';
      task.updatedAt = Date.now();
    }
  }

  getTaskStatus(taskId: TaskId): TaskStatus | undefined {
    return this.activeTasks.get(taskId)?.status;
  }

  getActiveTasks(): Task[] {
    return Array.from(this.activeTasks.values());
  }

  getQueueSize(): number {
    return this.taskQueue.length;
  }

  shutdown(): void {
    for (const task of this.activeTasks.values()) {
      task.status = 'cancelled';
    }
    this.activeTasks.clear();
    this.taskQueue = [];
  }
}
