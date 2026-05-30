import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '../core/agent';
import { AgentConfig, AgentContext } from '../core/types';
import {
  SequentialHandoffs,
  ParallelProcessing,
  ExpertTeam,
  DebateAndConsensus,
} from './patterns';

const mockExecutor = {
  execute: vi.fn().mockResolvedValue({ text: 'test response' }),
};

const createAgent = (name: string): Agent => {
  const config: AgentConfig = {
    name,
    systemPrompt: `You are ${name}`,
    model: { provider: 'test', model: 'test-model' },
  };
  return new Agent(config, mockExecutor);
};

const createContext = (taskId: string): AgentContext => ({
  sessionId: 'test-session',
  taskId,
  depth: 0,
  iteration: 0,
  startTime: Date.now(),
  metadata: {},
});

describe('Collaboration Patterns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SequentialHandoffs', () => {
    it('should execute agents in sequence', async () => {
      const agent1 = createAgent('Agent1');
      const agent2 = createAgent('Agent2');
      const agent3 = createAgent('Agent3');
      const context = createContext('seq_test');

      const collaboration = new SequentialHandoffs([agent1, agent2, agent3], context);
      const result = await collaboration.execute('Test prompt');

      expect(result.success).toBe(true);
      expect(mockExecutor.execute).toHaveBeenCalledTimes(3);
      expect(result.results.length).toBe(3);
    });
  });

  describe('ParallelProcessing', () => {
    it('should execute all agents concurrently', async () => {
      const agent1 = createAgent('Agent1');
      const agent2 = createAgent('Agent2');
      const agent3 = createAgent('Agent3');
      const context = createContext('parallel_test');

      const collaboration = new ParallelProcessing([agent1, agent2, agent3], context);
      const result = await collaboration.execute('Test prompt');

      expect(result.success).toBe(true);
      expect(mockExecutor.execute).toHaveBeenCalledTimes(3);
      expect(result.results.length).toBe(3);
    });

    it('should aggregate results from all agents', async () => {
      const agent1 = createAgent('Agent1');
      const agent2 = createAgent('Agent2');
      const context = createContext('parallel_agg');

      const collaboration = new ParallelProcessing([agent1, agent2], context);
      const result = await collaboration.execute('Test');

      expect(Array.isArray(result.finalOutput)).toBe(true);
      expect((result.finalOutput as string[]).length).toBe(2);
    });
  });

  describe('ExpertTeam', () => {
    it('should assign tasks based on specialty', async () => {
      const researcher = createAgent('Researcher');
      const analyst = createAgent('Analyst');
      const writer = createAgent('Writer');
      const context = createContext('expert_test');

      const collaboration = new ExpertTeam(
        [researcher, analyst, writer],
        context,
        ['research', 'analysis', 'writing']
      );
      const result = await collaboration.execute('Create report');

      expect(result.success).toBe(true);
      expect(mockExecutor.execute).toHaveBeenCalledTimes(3);
    });

    it('should track contributions', async () => {
      const researcher = createAgent('Researcher');
      const analyst = createAgent('Analyst');
      const context = createContext('expert_contrib');

      const collaboration = new ExpertTeam(
        [researcher, analyst],
        context,
        ['research', 'analysis']
      );
      await collaboration.execute('Test');

      const contributions = collaboration.getContributions();
      expect(contributions.length).toBe(2);
    });
  });

  describe('DebateAndConsensus', () => {
    it('should run multi-round debate', async () => {
      const agent1 = createAgent('Agent1');
      const agent2 = createAgent('Agent2');
      const agent3 = createAgent('Agent3');
      const context = createContext('debate_test');

      const collaboration = new DebateAndConsensus([agent1, agent2, agent3], context, { maxRounds: 2 });
      const result = await collaboration.execute('Debate topic');

      expect(result.success).toBe(true);
      expect(mockExecutor.execute).toHaveBeenCalled();
    });
  });
});