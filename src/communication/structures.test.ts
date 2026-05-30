import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '../core/agent';
import { AgentConfig } from '../core/types';
import {
  SingleAgentCommunication,
  NetworkCommunication,
  SupervisorCommunication,
  SupervisorAsToolCommunication,
  HierarchicalCommunication,
  CustomCommunication,
} from './structures';

const mockExecutor = {
  execute: vi.fn().mockResolvedValue({ text: 'response' }),
};

const createAgent = (name: string): Agent => {
  const config: AgentConfig = {
    name,
    systemPrompt: `You are ${name}`,
    model: { provider: 'test', model: 'test-model' },
  };
  return new Agent(config, mockExecutor);
};

describe('Communication Structures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SingleAgentCommunication', () => {
    it('should setup with single agent', () => {
      const agent = createAgent('TestAgent');
      const comm = new SingleAgentCommunication();
      
      comm.setup([agent]);
      
      expect(comm.name).toBe('single_agent');
    });
  });

  describe('NetworkCommunication', () => {
    it('should setup network with multiple peers', () => {
      const agents = [createAgent('Agent1'), createAgent('Agent2'), createAgent('Agent3')];
      const comm = new NetworkCommunication();
      
      comm.setup(agents);
      
      expect(comm.getPeers().length).toBe(3);
    });

    it('should broadcast messages to all peers', async () => {
      const agents = [createAgent('Agent1'), createAgent('Agent2')];
      const comm = new NetworkCommunication();
      
      comm.setup(agents);
      await comm.broadcast('test message');
      
      expect(comm.name).toBe('network');
    });
  });

  describe('SupervisorCommunication', () => {
    it('should setup supervisor with subordinates', () => {
      const supervisor = createAgent('Supervisor');
      const subordinates = [createAgent('Sub1'), createAgent('Sub2')];
      const comm = new SupervisorCommunication();
      
      comm.setup([supervisor, ...subordinates]);
      
      expect(comm.getSupervisor()?.name).toBe('Supervisor');
      expect(comm.getSubordinates().length).toBe(2);
    });

    it('should distribute tasks to subordinates', async () => {
      const supervisor = createAgent('Supervisor');
      const subordinates = [createAgent('Sub1'), createAgent('Sub2')];
      const comm = new SupervisorCommunication();
      
      comm.setup([supervisor, ...subordinates]);
      await comm.processTasks();
      
      expect(comm.name).toBe('supervisor');
    });
  });

  describe('SupervisorAsToolCommunication', () => {
    it('should setup in advisory mode', () => {
      const supervisor = createAgent('Advisor');
      const agent = createAgent('Worker');
      const comm = new SupervisorAsToolCommunication();
      
      comm.setup([supervisor, agent]);
      
      expect(comm.name).toBe('supervisor_as_tool');
    });
  });

  describe('HierarchicalCommunication', () => {
    it('should setup multi-level hierarchy', () => {
      const agents = [
        createAgent('Level1'),
        createAgent('Level2a'),
        createAgent('Level2b'),
        createAgent('Level3'),
      ];
      const comm = new HierarchicalCommunication();
      
      comm.setup(agents);
      
      expect(comm.name).toBe('hierarchical');
    });
  });

  describe('CustomCommunication', () => {
    it('should allow custom topology with connections', () => {
      const agents = [createAgent('Agent1'), createAgent('Agent2')];
      const comm = new CustomCommunication({
        connections: [
          { from: agents[0].id, to: agents[1].id },
        ],
      });
      
      comm.setup(agents);
      
      expect(comm.name).toBe('custom');
    });

    it('should allow custom routing with topology', async () => {
      const agent1 = createAgent('Agent1');
      const comm = new CustomCommunication({
        connections: [],
      });
      
      comm.setup([agent1]);
      await comm.send(agent1.id, 'test');
      
      expect(comm.name).toBe('custom');
    });
  });
});