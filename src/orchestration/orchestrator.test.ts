import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '../core/agent';
import { AgentConfig, AgentId } from '../core/types';
import { Orchestrator } from './orchestrator';
import { Planner } from './planner';

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

describe('Orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Orchestrator', () => {
    it('should create orchestrator with default settings', () => {
      const orchestrator = new Orchestrator();
      
      expect(orchestrator).toBeDefined();
    });

    it('should register agents', () => {
      const orchestrator = new Orchestrator();
      const agent1 = createAgent('Agent1');
      const agent2 = createAgent('Agent2');
      
      orchestrator.registerAgent(agent1);
      orchestrator.registerAgent(agent2);
      
      const registered = orchestrator.getRegistry().getAllAgents();
      expect(registered.length).toBe(2);
      expect(registered[0].name).toBe('Agent1');
    });

    it('should execute goal with researcher agent', async () => {
      const orchestrator = new Orchestrator({ maxConcurrentTasks: 3 });
      const researcher = createAgent('Researcher');
      
      orchestrator.registerAgent(researcher);
      
      const results = await orchestrator.executeGoal('Research AI Agent frameworks');
      
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });

  describe('Planner', () => {
    it('should create a plan from goal', async () => {
      const planner = new Planner();
      
      const plan = await planner.createPlan(
        'Create a comprehensive report',
        [{ id: 'agent1' as AgentId, capabilities: ['research', 'writing'] }]
      );
      
      expect(plan).toBeDefined();
      expect(plan.id).toBeDefined();
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it('should validate task dependencies', () => {
      const planner = new Planner();
      
      const tasks = [
        { id: 'task1' as never, dependencies: [] },
        { id: 'task2' as never, dependencies: ['task1' as never] },
      ];
      
      expect(() => planner['validateDependencies'](tasks as never)).not.toThrow();
    });

    it('should detect cycles in dependencies', () => {
      const planner = new Planner();
      
      const dependencies = new Map([
        ['task1' as never, ['task2' as never]],
        ['task2' as never, ['task1' as never]],
      ]);
      
      expect(() => planner['detectCycles'](dependencies)).toThrow();
    });
  });
});