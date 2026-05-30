import { describe, it, expect, beforeEach } from 'vitest';
import { Evaluator } from './evaluator';
import { TaskId } from '../core/types';

describe('Evaluator', () => {
  beforeEach(() => {
    // Reset evaluator before each test
  });

  describe('Evaluator', () => {
    it('should create evaluator with default settings', () => {
      const evaluator = new Evaluator();
      
      expect(evaluator).toBeDefined();
    });

    it('should evaluate task results', async () => {
      const evaluator = new Evaluator({ passThreshold: 0.7 });
      
      const mockResult = {
        taskId: 'task1' as TaskId,
        success: true,
        data: {
          text: 'This is a comprehensive response with detailed information covering all aspects.',
        },
        executionTime: 1000,
        agentId: 'agent1' as never,
      };
      
      const evaluation = await evaluator.evaluate(mockResult);
      
      expect(evaluation).toBeDefined();
      expect(evaluation.score).toBeDefined();
      expect(typeof evaluation.score).toBe('number');
    });

    it('should provide suggestions for improvement', async () => {
      const evaluator = new Evaluator({ passThreshold: 0.9 });
      
      const mockResult = {
        taskId: 'task1' as TaskId,
        success: true,
        data: {
          text: 'This is a response that could be better.',
        },
        executionTime: 1000,
        agentId: 'agent1' as never,
      };
      
      const evaluation = await evaluator.evaluate(mockResult);
      
      expect(evaluation.suggestions).toBeDefined();
      expect(Array.isArray(evaluation.suggestions)).toBe(true);
    });

    it('should provide reflection on results', async () => {
      const evaluator = new Evaluator({ enableReflection: true });
      
      const mockResult = {
        taskId: 'task1' as TaskId,
        success: true,
        data: {
          text: 'This is some content that needs review.',
        },
        executionTime: 1000,
        agentId: 'agent1' as never,
      };
      
      const evaluation = await evaluator.evaluate(mockResult);
      const reflection = await evaluator.reflect(mockResult, evaluation);
      
      expect(reflection).toBeDefined();
      expect(reflection.shouldRetry).toBeDefined();
      expect(typeof reflection.shouldRetry).toBe('boolean');
    });

    it('should calculate weighted score from dimensions', () => {
      const evaluator = new Evaluator();
      
      const dimensions = [
        { name: 'accuracy', score: 0.9, weight: 0.3 },
        { name: 'completeness', score: 0.8, weight: 0.3 },
        { name: 'relevance', score: 0.7, weight: 0.4 },
      ];
      
      const score = evaluator.calculateWeightedScore(dimensions);
      
      expect(typeof score).toBe('number');
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should evaluate with custom dimensions', async () => {
      const evaluator = new Evaluator({
        passThreshold: 0.7,
        dimensions: [
          { name: 'clarity', weight: 0.5 },
          { name: 'depth', weight: 0.5 },
        ],
      });
      
      const mockResult = {
        taskId: 'task1' as TaskId,
        success: true,
        data: {
          text: 'Clear and detailed explanation of the topic.',
        },
        executionTime: 1000,
        agentId: 'agent1' as never,
      };
      
      const evaluation = await evaluator.evaluate(mockResult);
      
      expect(evaluation.dimensions.length).toBe(2);
      expect(evaluation.dimensions[0].name).toBe('clarity');
      expect(evaluation.dimensions[1].name).toBe('depth');
    });
  });
});