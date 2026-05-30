import { SessionId, AgentId, TaskId } from '../core/types.js';

export interface AgentOutput {
  agentId: AgentId;
  agentName: string;
  taskId: TaskId;
  output: string;
  timestamp: number;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface AgentMessage {
  id: string;
  fromAgentId: AgentId;
  fromAgentName: string;
  toAgentId: AgentId | 'broadcast';
  type: 'data' | 'request' | 'response' | 'notification' | 'feedback';
  content: string;
  timestamp: number;
  relatedTaskId?: TaskId;
}

export interface SessionContextSnapshot {
  sessionId: SessionId;
  goal: string;
  currentPhase: string;
  completedTasks: TaskId[];
  pendingTasks: TaskId[];
  agentOutputs: Map<TaskId, AgentOutput>;
  messages: AgentMessage[];
  globalContext: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export class EnhancedSharedMemory {
  private agentOutputs: Map<TaskId, AgentOutput> = new Map();
  private agentMessages: AgentMessage[] = [];
  private globalContext: Record<string, unknown> = {};
  private sessionGoal: string = '';
  private currentPhase: string = 'idle';
  private completedTasks: Set<TaskId> = new Set();
  private pendingTasks: Set<TaskId> = new Set();
  private agentRegistry: Map<AgentId, { name: string; type: string; status: string }> = new Map();
  private createdAt: number;
  private updatedAt: number;
  private sessionId: SessionId;

  constructor(sessionId: SessionId) {
    this.sessionId = sessionId;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  setGoal(goal: string): void {
    this.sessionGoal = goal;
    this.updatedAt = Date.now();
  }

  getGoal(): string {
    return this.sessionGoal;
  }

  setPhase(phase: string): void {
    this.currentPhase = phase;
    this.updatedAt = Date.now();
  }

  getPhase(): string {
    return this.currentPhase;
  }

  registerAgent(agentId: AgentId, name: string, type: string): void {
    this.agentRegistry.set(agentId, { name, type, status: 'idle' });
    this.updatedAt = Date.now();
  }

  updateAgentStatus(agentId: AgentId, status: string): void {
    const agent = this.agentRegistry.get(agentId);
    if (agent) {
      agent.status = status;
      this.updatedAt = Date.now();
    }
  }

  getAgentInfo(agentId: AgentId): { name: string; type: string; status: string } | undefined {
    return this.agentRegistry.get(agentId);
  }

  getAllAgents(): Array<{ id: AgentId; name: string; type: string; status: string }> {
    return Array.from(this.agentRegistry.entries()).map(([id, info]) => ({ id, ...info }));
  }

  storeAgentOutput(taskId: TaskId, output: AgentOutput): void {
    this.agentOutputs.set(taskId, output);
    this.completedTasks.add(taskId);
    this.pendingTasks.delete(taskId);
    this.updatedAt = Date.now();
  }

  getAgentOutput(taskId: TaskId): AgentOutput | undefined {
    return this.agentOutputs.get(taskId);
  }

  getOutputsByAgent(agentId: AgentId): AgentOutput[] {
    return Array.from(this.agentOutputs.values()).filter((o) => o.agentId === agentId);
  }

  getAllOutputs(): AgentOutput[] {
    return Array.from(this.agentOutputs.values());
  }

  getOutputsByTag(tag: string): AgentOutput[] {
    return Array.from(this.agentOutputs.values()).filter((o) => o.tags.includes(tag));
  }

  addPendingTask(taskId: TaskId): void {
    this.pendingTasks.add(taskId);
    this.updatedAt = Date.now();
  }

  completeTask(taskId: TaskId): void {
    this.completedTasks.add(taskId);
    this.pendingTasks.delete(taskId);
    this.updatedAt = Date.now();
  }

  getCompletedTasks(): TaskId[] {
    return Array.from(this.completedTasks);
  }

  getPendingTasks(): TaskId[] {
    return Array.from(this.pendingTasks);
  }

  sendMessage(message: Omit<AgentMessage, 'id' | 'timestamp'>): string {
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const fullMessage: AgentMessage = {
      id: msgId,
      ...message,
      timestamp: Date.now(),
    };
    this.agentMessages.push(fullMessage);
    this.updatedAt = Date.now();
    return msgId;
  }

  getMessagesForAgent(agentId: AgentId): AgentMessage[] {
    return this.agentMessages.filter(
      (m) => m.toAgentId === agentId || m.toAgentId === 'broadcast'
    );
  }

  getMessagesBetween(agent1Id: AgentId, agent2Id: AgentId): AgentMessage[] {
    return this.agentMessages.filter(
      (m) =>
        (m.fromAgentId === agent1Id && m.toAgentId === agent2Id) ||
        (m.fromAgentId === agent2Id && m.toAgentId === agent1Id)
    );
  }

  getAllMessages(): AgentMessage[] {
    return [...this.agentMessages];
  }

  setGlobalContext(key: string, value: unknown): void {
    this.globalContext[key] = value;
    this.updatedAt = Date.now();
  }

  getGlobalContext(key: string): unknown {
    return this.globalContext[key];
  }

  getAllGlobalContext(): Record<string, unknown> {
    return { ...this.globalContext };
  }

  buildContextForAgent(agentId: AgentId, taskId?: TaskId): string {
    const parts: string[] = [];

    if (this.sessionGoal) {
      parts.push(`## Session Goal\n${this.sessionGoal}`);
    }

    parts.push(`## Current Phase\n${this.currentPhase}`);

    const agentInfo = this.agentRegistry.get(agentId);
    if (agentInfo) {
      parts.push(`## Your Role\nName: ${agentInfo.name}, Type: ${agentInfo.type}`);
    }

    const completedOutputs = Array.from(this.agentOutputs.values())
      .filter((o) => o.agentId !== agentId)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (completedOutputs.length > 0) {
      parts.push('## Other Agents\' Outputs');
      for (const output of completedOutputs) {
        parts.push(`### ${output.agentName} (Task: ${output.taskId})\n${output.output.substring(0, 2000)}`);
      }
    }

    const messages = this.getMessagesForAgent(agentId);
    if (messages.length > 0) {
      parts.push('## Messages For You');
      for (const msg of messages.slice(-5)) {
        parts.push(`[${msg.fromAgentName} -> You]: ${msg.content.substring(0, 500)}`);
      }
    }

    if (taskId) {
      const taskOutput = this.agentOutputs.get(taskId);
      if (taskOutput) {
        parts.push(`## Your Previous Output for Task ${taskId}\n${taskOutput.output.substring(0, 1000)}`);
      }
    }

    return parts.join('\n\n');
  }

  getSnapshot(): SessionContextSnapshot {
    return {
      sessionId: this.sessionId,
      goal: this.sessionGoal,
      currentPhase: this.currentPhase,
      completedTasks: Array.from(this.completedTasks),
      pendingTasks: Array.from(this.pendingTasks),
      agentOutputs: new Map(this.agentOutputs),
      messages: [...this.agentMessages],
      globalContext: { ...this.globalContext },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  getStats(): {
    totalAgents: number;
    totalOutputs: number;
    totalMessages: number;
    completedTaskCount: number;
    pendingTaskCount: number;
    sessionDurationMs: number;
  } {
    return {
      totalAgents: this.agentRegistry.size,
      totalOutputs: this.agentOutputs.size,
      totalMessages: this.agentMessages.length,
      completedTaskCount: this.completedTasks.size,
      pendingTaskCount: this.pendingTasks.size,
      sessionDurationMs: Date.now() - this.createdAt,
    };
  }

  clear(): void {
    this.agentOutputs.clear();
    this.agentMessages = [];
    this.globalContext = {};
    this.completedTasks.clear();
    this.pendingTasks.clear();
    this.agentRegistry.clear();
    this.sessionGoal = '';
    this.currentPhase = 'idle';
    this.updatedAt = Date.now();
  }
}
