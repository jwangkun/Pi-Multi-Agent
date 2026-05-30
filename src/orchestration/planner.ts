import {
  Task,
  TaskId,
  TaskPriority,
  ExecutionPlan,
  ExecutionStep,
  AgentId,
  AgentContext,
} from '../core/types.js';
import { PlanningError, TaskDependencyError } from '../core/errors.js';

let taskIdCounter = 0;
let planIdCounter = 0;

function generateTaskId(): TaskId {
  return `task_${Date.now()}_${++taskIdCounter}` as TaskId;
}

function generatePlanId(): string {
  return `plan_${Date.now()}_${++planIdCounter}`;
}

export interface PlanTemplate {
  name: string;
  description: string;
  steps: Array<{
    name: string;
    description: string;
    agentType?: string;
    estimatedTime?: number;
    dependsOn?: string[];
  }>;
}

export interface PlannerConfig {
  maxTasks?: number;
  maxDepth?: number;
  defaultPriority?: TaskPriority;
  enableDependencyValidation?: boolean;
  enableCycleDetection?: boolean;
}

export class Planner {
  private config: Required<PlannerConfig>;
  private templates: Map<string, PlanTemplate> = new Map();

  constructor(config: PlannerConfig = {}) {
    this.config = {
      maxTasks: config.maxTasks ?? 100,
      maxDepth: config.maxDepth ?? 10,
      defaultPriority: config.defaultPriority ?? 'normal',
      enableDependencyValidation: config.enableDependencyValidation ?? true,
      enableCycleDetection: config.enableCycleDetection ?? true,
    };
  }

  registerTemplate(template: PlanTemplate): void {
    this.templates.set(template.name, template);
  }

  getTemplate(name: string): PlanTemplate | undefined {
    return this.templates.get(name);
  }

  async createPlan(
    goal: string,
    availableAgents: Array<{ id: AgentId; capabilities: string[] }>,
    _context: Partial<AgentContext> = {}
  ): Promise<ExecutionPlan> {
    if (!goal || goal.trim().length === 0) {
      throw new PlanningError('Goal cannot be empty');
    }

    const taskId = generateTaskId();
    const planId = generatePlanId();

    const tasks = await this.decomposeGoal(goal, availableAgents);

    if (tasks.length > this.config.maxTasks) {
      throw new PlanningError(
        `Too many tasks generated (${tasks.length}). Maximum allowed: ${this.config.maxTasks}`
      );
    }

    const steps: ExecutionStep[] = tasks.map((task, index) => ({
      id: `step_${index}`,
      taskId: task.id,
      agentId: task.assignedAgent ?? ('' as AgentId),
      action: task.type,
      input: task.input,
      status: 'pending',
      dependencies: task.dependencies,
      estimatedTime: undefined,
      retryCount: 0,
      maxRetries: 3,
    }));

    const dependencies = new Map<TaskId, TaskId[]>();
    for (const task of tasks) {
      dependencies.set(task.id, task.dependencies as TaskId[]);
    }

    if (this.config.enableDependencyValidation) {
      this.validateDependencies(tasks);
    }

    if (this.config.enableCycleDetection) {
      this.detectCycles(dependencies);
    }

    const plan: ExecutionPlan = {
      id: planId,
      taskId,
      steps,
      dependencies,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return plan;
  }

  private async decomposeGoal(
    goal: string,
    availableAgents: Array<{ id: AgentId; capabilities: string[] }>
  ): Promise<Task[]> {
    const tasks: Task[] = [];

    const goalLower = goal.toLowerCase();

    if (
      goalLower.includes('research') ||
      goalLower.includes('调研') ||
      goalLower.includes('search') ||
      goalLower.includes('查找')
    ) {
      const researcherAgent = availableAgents.find((a) =>
        a.capabilities.some((c) => c.includes('research') || c.includes('search'))
      );

      tasks.push({
        id: generateTaskId(),
        type: 'research',
        description: `Research and gather information: ${goal}`,
        input: goal,
        status: 'pending',
        priority: this.config.defaultPriority,
        assignedAgent: researcherAgent?.id,
        dependencies: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    if (
      goalLower.includes('analyze') ||
      goalLower.includes('分析')
    ) {
      const analystAgent = availableAgents.find((a) =>
        a.capabilities.some((c) => c.includes('analyze') || c.includes('analysis'))
      );

      const researchTask = tasks.find((t) => t.type === 'research');
      
      tasks.push({
        id: generateTaskId(),
        type: 'analysis',
        description: `Analyze data and extract insights: ${goal}`,
        input: goal,
        status: 'pending',
        priority: this.config.defaultPriority,
        assignedAgent: analystAgent?.id,
        dependencies: researchTask ? [researchTask.id] : [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    if (
      goalLower.includes('write') ||
      goalLower.includes('create') ||
      goalLower.includes('撰写') ||
      goalLower.includes('生成')
    ) {
      const writerAgent = availableAgents.find((a) =>
        a.capabilities.some((c) => c.includes('write') || c.includes('create'))
      );

      const previousTask = tasks[tasks.length - 1];

      tasks.push({
        id: generateTaskId(),
        type: 'creation',
        description: `Create content based on analysis: ${goal}`,
        input: goal,
        status: 'pending',
        priority: this.config.defaultPriority,
        assignedAgent: writerAgent?.id,
        dependencies: previousTask ? [previousTask.id] : [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    if (tasks.length === 0) {
      const defaultAgent = availableAgents[0];
      
      tasks.push({
        id: generateTaskId(),
        type: 'general',
        description: `Execute: ${goal}`,
        input: goal,
        status: 'pending',
        priority: this.config.defaultPriority,
        assignedAgent: defaultAgent?.id,
        dependencies: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    return tasks;
  }

  private validateDependencies(tasks: Task[]): void {
    const taskIds = new Set(tasks.map((t) => t.id));

    for (const task of tasks) {
      for (const depId of task.dependencies) {
        if (!taskIds.has(depId as string)) {
          throw new TaskDependencyError(
            `Task ${task.id} depends on non-existent task ${depId}`
          );
        }
      }
    }
  }

  private detectCycles(dependencies: Map<TaskId, TaskId[]>): void {
    const visited = new Set<TaskId>();
    const recursionStack = new Set<TaskId>();

    const dfs = (nodeId: TaskId): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const deps = dependencies.get(nodeId) ?? [];
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (dfs(dep)) {
            return true;
          }
        } else if (recursionStack.has(dep)) {
          throw new PlanningError(`Circular dependency detected involving task ${nodeId}`);
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of dependencies.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }
  }

  updatePlan(plan: ExecutionPlan, updates: Partial<ExecutionPlan>): ExecutionPlan {
    return {
      ...plan,
      ...updates,
      updatedAt: Date.now(),
    };
  }

  updateStepStatus(
    plan: ExecutionPlan,
    stepId: string,
    status: ExecutionStep['status'],
    error?: Error
  ): ExecutionPlan {
    const steps = plan.steps.map((step) => {
      if (step.id === stepId) {
        return {
          ...step,
          status,
          error: error as ExecutionStep['error'],
        };
      }
      return step;
    });

    return {
      ...plan,
      steps,
      updatedAt: Date.now(),
    };
  }

  getExecutableSteps(plan: ExecutionPlan): ExecutionStep[] {
    const completedSteps = new Set<string>();
    const failedSteps = new Set<string>();

    for (const step of plan.steps) {
      if (step.status === 'completed') {
        completedSteps.add(step.id);
      } else if (step.status === 'failed') {
        failedSteps.add(step.id);
      }
    }

    return plan.steps.filter((step) => {
      if (step.status !== 'pending') {
        return false;
      }

      for (const depId of step.dependencies) {
        if (failedSteps.has(depId)) {
          return false;
        }
        if (!completedSteps.has(depId)) {
          return false;
        }
      }

      return true;
    });
  }

  isPlanComplete(plan: ExecutionPlan): boolean {
    return plan.steps.every((step) => step.status === 'completed');
  }

  getPlanProgress(plan: ExecutionPlan): { completed: number; total: number; percentage: number } {
    const completed = plan.steps.filter((s) => s.status === 'completed').length;
    const total = plan.steps.length;
    return {
      completed,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }
}
