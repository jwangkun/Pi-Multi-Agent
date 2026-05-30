import {
  TaskResult,
  AgentId,
} from '../core/types.js';
import { Agent } from '../core/agent.js';
import { MessageBus } from '../core/message.js';

export interface CommunicationStructure {
  name: string;
  description: string;
}

export abstract class BaseCommunication implements CommunicationStructure {
  abstract readonly name: string;
  abstract readonly description: string;

  protected messageBus: MessageBus;

  constructor(messageBus?: MessageBus) {
    this.messageBus = messageBus ?? new MessageBus();
  }

  abstract setup(agents: Agent[]): void;
  abstract send(agentId: AgentId, message: unknown): Promise<void>;
  abstract broadcast(message: unknown): Promise<void>;
}

export class SingleAgentCommunication extends BaseCommunication {
  readonly name = 'single_agent';
  readonly description = 'Standalone agent without external communication';

  private agent?: Agent;

  setup(agents: Agent[]): void {
    if (agents.length !== 1) {
      throw new Error('SingleAgentCommunication requires exactly one agent');
    }
    this.agent = agents[0];
  }

  async send(agentId: AgentId, _message: unknown): Promise<void> {
    if (this.agent?.id !== agentId) {
      throw new Error('Cannot send message: agent not found');
    }
  }

  async broadcast(_message: unknown): Promise<void> {
    throw new Error('Broadcast not supported in SingleAgentCommunication');
  }

  getAgent(): Agent | undefined {
    return this.agent;
  }
}

export interface PeerInfo {
  agentId: AgentId;
  address?: string;
  capabilities: string[];
}

export class NetworkCommunication extends BaseCommunication {
  readonly name = 'network';
  readonly description = 'Decentralized peer-to-peer communication';

  private peers: Map<AgentId, PeerInfo> = new Map();
  private messageHistory: Array<{ from: AgentId; to: AgentId; message: unknown; timestamp: number }> = [];

  setup(agents: Agent[]): void {
    for (const agent of agents) {
      this.peers.set(agent.id, {
        agentId: agent.id,
        capabilities: this.extractCapabilities(agent),
      });
    }
  }

  async send(agentId: AgentId, message: unknown): Promise<void> {
    if (!this.peers.has(agentId)) {
      throw new Error(`Agent ${agentId} not found in network`);
    }

    this.messageHistory.push({
      from: '' as AgentId,
      to: agentId,
      message,
      timestamp: Date.now(),
    });
  }

  async broadcast(message: unknown): Promise<void> {
    for (const peerId of this.peers.keys()) {
      await this.send(peerId, message);
    }
  }

  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values());
  }

  getMessageHistory(from?: AgentId, to?: AgentId): Array<{ from: AgentId; to: AgentId; message: unknown; timestamp: number }> {
    return this.messageHistory.filter((entry) => {
      if (from && entry.from !== from) return false;
      if (to && entry.to !== to) return false;
      return true;
    });
  }

  private extractCapabilities(agent: Agent): string[] {
    const capabilities: string[] = [];
    if (agent.name.toLowerCase().includes('research')) capabilities.push('research');
    if (agent.name.toLowerCase().includes('analyst')) capabilities.push('analysis');
    if (agent.name.toLowerCase().includes('writer')) capabilities.push('writing');
    return capabilities;
  }
}

export class SupervisorCommunication extends BaseCommunication {
  readonly name = 'supervisor';
  readonly description = 'Centralized supervisor manages all agents';

  private supervisor?: Agent;
  private subordinates: Map<AgentId, Agent> = new Map();
  private taskQueue: Array<{ task: string; assignedAgent?: AgentId }> = [];

  setup(agents: Agent[]): void {
    if (agents.length < 2) {
      throw new Error('SupervisorCommunication requires at least 2 agents');
    }

    this.supervisor = agents[0];
    for (let i = 1; i < agents.length; i++) {
      const agent = agents[i];
      if (agent) {
        this.subordinates.set(agent.id, agent);
      }
    }
  }

  async send(agentId: AgentId, _message: unknown): Promise<void> {
    if (!this.supervisor && !this.subordinates.has(agentId)) {
      throw new Error(`Agent ${agentId} not found`);
    }
  }

  async broadcast(message: unknown): Promise<void> {
    if (this.supervisor) {
      await this.send(this.supervisor.id, message);
    }
  }

  async assignTask(agentId: AgentId, task: string): Promise<void> {
    if (!this.subordinates.has(agentId)) {
      throw new Error(`Cannot assign task: agent ${agentId} not found`);
    }

    this.taskQueue.push({ task, assignedAgent: agentId });
  }

  getSupervisor(): Agent | undefined {
    return this.supervisor;
  }

  getSubordinates(): Agent[] {
    return Array.from(this.subordinates.values());
  }

  getTaskQueue(): Array<{ task: string; assignedAgent?: AgentId }> {
    return [...this.taskQueue];
  }

  async processTasks(): Promise<TaskResult[]> {
    const results: TaskResult[] = [];

    for (const item of this.taskQueue) {
      if (item.assignedAgent) {
        const agent = this.subordinates.get(item.assignedAgent);
        if (agent) {
          const result = await agent.execute(item.task, {
            sessionId: '' as never,
            taskId: '' as never,
            depth: 0,
            iteration: 0,
            startTime: Date.now(),
            metadata: { source: 'supervisor' },
          });
          results.push(result);
        }
      }
    }

    this.taskQueue = [];
    return results;
  }
}

export class SupervisorAsToolCommunication extends BaseCommunication {
  readonly name = 'supervisor_as_tool';
  readonly description = 'Supervisor provides advice without direct control';

  private advisors: Map<AgentId, Agent> = new Map();
  private requestHistory: Array<{ requester: AgentId; advisor: AgentId; question: string; answer?: string }> = [];

  setup(agents: Agent[]): void {
    for (const agent of agents) {
      this.advisors.set(agent.id, agent);
    }
  }

  async send(agentId: AgentId, _message: unknown): Promise<void> {
    if (!this.advisors.has(agentId)) {
      throw new Error(`Advisor ${agentId} not found`);
    }
  }

  async broadcast(message: unknown): Promise<void> {
    for (const advisorId of this.advisors.keys()) {
      await this.send(advisorId, message);
    }
  }

  async consult(agentId: AgentId, requesterId: AgentId, question: string): Promise<string> {
    const advisor = this.advisors.get(agentId);
    if (!advisor) {
      throw new Error(`Advisor ${agentId} not found`);
    }

    const result = await advisor.execute(question, {
      sessionId: '' as never,
      taskId: '' as never,
      depth: 0,
      iteration: 0,
      startTime: Date.now(),
      metadata: { type: 'consultation', requester: requesterId },
    });

    const answer = (result.data as { text?: string })?.text ?? '';

    this.requestHistory.push({
      requester: requesterId,
      advisor: agentId,
      question,
      answer,
    });

    return answer;
  }

  getAdvisors(): Agent[] {
    return Array.from(this.advisors.values());
  }

  getRequestHistory(): Array<{ requester: AgentId; advisor: AgentId; question: string; answer?: string }> {
    return [...this.requestHistory];
  }
}

export interface HierarchyLevel {
  level: number;
  agents: Agent[];
}

export class HierarchicalCommunication extends BaseCommunication {
  readonly name = 'hierarchical';
  readonly description = 'Multi-level management hierarchy';

  private levels: HierarchyLevel[] = [];
  private parentChildMap: Map<AgentId, AgentId[]> = new Map();
  private childParentMap: Map<AgentId, AgentId> = new Map();

  setup(agents: Agent[]): void {
    this.levels = [];
    
    if (agents.length === 0) return;

    const supervisor = agents[0];
    if (!supervisor) return;

    this.levels.push({
      level: 0,
      agents: [supervisor],
    });

    this.parentChildMap.set(supervisor.id, []);

    if (agents.length > 1) {
      const subordinates = agents.slice(1).filter(agent => agent !== undefined) as Agent[];
      this.levels.push({
        level: 1,
        agents: subordinates,
      });

      for (const child of subordinates) {
        this.childParentMap.set(child.id, supervisor.id);
        
        const children = this.parentChildMap.get(supervisor.id) ?? [];
        children.push(child.id);
        this.parentChildMap.set(supervisor.id, children);
      }
    }
  }

  async send(agentId: AgentId, _message: unknown): Promise<void> {
    const exists = this.levels.some((level) => level.agents.some((a) => a.id === agentId));
    if (!exists) {
      throw new Error(`Agent ${agentId} not found in hierarchy`);
    }
  }

  async broadcast(message: unknown): Promise<void> {
    for (const level of this.levels) {
      for (const agent of level.agents) {
        await this.send(agent.id, message);
      }
    }
  }

  async sendToParent(childId: AgentId, message: unknown): Promise<void> {
    const parentId = this.childParentMap.get(childId);
    if (parentId) {
      await this.send(parentId, message);
    }
  }

  async sendToChildren(parentId: AgentId, message: unknown): Promise<void> {
    const children = this.parentChildMap.get(parentId) ?? [];
    for (const childId of children) {
      await this.send(childId, message);
    }
  }

  getLevels(): HierarchyLevel[] {
    return [...this.levels];
  }

  getParent(agentId: AgentId): AgentId | undefined {
    return this.childParentMap.get(agentId);
  }

  getChildren(agentId: AgentId): AgentId[] {
    return this.parentChildMap.get(agentId) ?? [];
  }
}

export interface TopologyConfig {
  type: string;
  connections?: Array<{ from: string; to: string }>;
}

export class CustomCommunication extends BaseCommunication {
  readonly name = 'custom';
  readonly description = 'Custom topology based on provided configuration';

  private topology: TopologyConfig;
  private connections: Map<AgentId, Set<AgentId>> = new Map();
  private agents: Map<AgentId, Agent> = new Map();

  constructor(topology: TopologyConfig) {
    super();
    this.topology = topology;
  }

  setup(agents: Agent[]): void {
    for (const agent of agents) {
      this.agents.set(agent.id, agent);
      this.connections.set(agent.id, new Set());
    }

    if (this.topology.connections) {
      for (const conn of this.topology.connections) {
        const fromId = conn.from as AgentId;
        const toId = conn.to as AgentId;
        
        if (this.agents.has(fromId) && this.agents.has(toId)) {
          const fromConnections = this.connections.get(fromId);
          if (fromConnections) {
            fromConnections.add(toId);
          }
        }
      }
    }
  }

  async send(agentId: AgentId, _message: unknown): Promise<void> {
    if (!this.agents.has(agentId)) {
      throw new Error(`Agent ${agentId} not found`);
    }
  }

  async broadcast(message: unknown): Promise<void> {
    for (const agentId of this.agents.keys()) {
      await this.send(agentId, message);
    }
  }

  getConnections(agentId: AgentId): AgentId[] {
    const conns = this.connections.get(agentId);
    return conns ? Array.from(conns) : [];
  }

  isConnected(fromId: AgentId, toId: AgentId): boolean {
    const conns = this.connections.get(fromId);
    return conns ? conns.has(toId) : false;
  }

  getTopology(): TopologyConfig {
    return { ...this.topology };
  }
}

export function createCommunicationStructure(
  type: string,
  config?: TopologyConfig
): BaseCommunication {
  switch (type) {
    case 'single_agent':
      return new SingleAgentCommunication();
    case 'network':
      return new NetworkCommunication();
    case 'supervisor':
      return new SupervisorCommunication();
    case 'supervisor_as_tool':
      return new SupervisorAsToolCommunication();
    case 'hierarchical':
      return new HierarchicalCommunication();
    case 'custom':
      if (!config) {
        throw new Error('Custom topology requires configuration');
      }
      return new CustomCommunication(config);
    default:
      throw new Error(`Unknown communication structure type: ${type}`);
  }
}
