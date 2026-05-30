import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from './agent';
import { AgentConfig, AgentContext } from './types';
import { PiAgentError } from './errors';

describe('Agent', () => {
  const mockExecutor = {
    execute: vi.fn().mockResolvedValue({ text: 'test response' }),
  };

  const config: AgentConfig = {
    name: 'Test Agent',
    systemPrompt: 'You are a helpful assistant.',
    model: {
      provider: 'test',
      model: 'test-model',
    },
  };

  let agent: Agent;
  let context: AgentContext;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new Agent(config, mockExecutor);
    context = {
      sessionId: 'test-session',
      taskId: 'test-task',
      depth: 0,
      iteration: 0,
      startTime: Date.now(),
      metadata: {},
    };
  });

  describe('constructor', () => {
    it('should create an agent with default values', () => {
      expect(agent.id).toBeDefined();
      expect(agent.name).toBe('Test Agent');
      expect(agent.description).toBe('');
      expect(agent.maxRetries).toBe(3);
      expect(agent.timeout).toBe(60000);
    });
  });

  describe('execute', () => {
    it('should execute the agent and return a result', async () => {
      const result = await agent.execute('Hello', context);
      
      expect(mockExecutor.execute).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.taskId).toBe('test-task');
      expect(result.agentId).toBe(agent.id);
    });

    it('should handle execution errors', async () => {
      const error = new PiAgentError('Test error', 'TEST_ERROR', { retryable: false });
      mockExecutor.execute.mockRejectedValue(error);
      
      await expect(agent.execute('Hello', context)).rejects.toThrow(PiAgentError);
    });

    it('should retry on retryable errors', async () => {
      const retryableError = new PiAgentError('Retryable', 'RETRY_ERROR', { retryable: true });
      mockExecutor.execute
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue({ text: 'success' });
      
      const result = await agent.execute('Hello', { ...context, iteration: 0 });
      
      expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });
  });

  describe('getState', () => {
    it('should return the current state', () => {
      expect(agent.getState()).toBe('idle');
    });
  });

  describe('getStats', () => {
    it('should return agent stats', () => {
      const stats = agent.getStats();
      
      expect(stats.state).toBe('idle');
      expect(stats.metrics.totalInvocations).toBe(0);
      expect(stats.metrics.successfulInvocations).toBe(0);
      expect(stats.metrics.failedInvocations).toBe(0);
    });
  });

  describe('reset', () => {
    it('should reset agent metrics and state', async () => {
      await agent.execute('Hello', context);
      
      const statsBefore = agent.getStats();
      expect(statsBefore.metrics.totalInvocations).toBe(1);
      
      agent.reset();
      
      const statsAfter = agent.getStats();
      expect(statsAfter.state).toBe('idle');
      expect(statsAfter.metrics.totalInvocations).toBe(0);
    });
  });
});