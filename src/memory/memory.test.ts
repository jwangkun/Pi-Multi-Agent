import { describe, it, expect, beforeEach } from 'vitest';
import { Memory, SharedMemory } from './memory';

describe('Memory System', () => {
  beforeEach(() => {
    // Reset memory before each test
  });

  describe('Memory', () => {
    it('should create memory with default settings', () => {
      const memory = new Memory();
      
      expect(memory).toBeDefined();
      expect(memory.keys().length).toBe(0);
    });

    it('should set and get values', () => {
      const memory = new Memory();
      
      memory.set('key1', 'value1');
      memory.set('key2', { nested: 'object' });
      
      expect(memory.get<string>('key1')).toBe('value1');
      expect(memory.get<{ nested: string }>('key2')).toEqual({ nested: 'object' });
    });

    it('should handle non-existent keys', () => {
      const memory = new Memory();
      
      expect(memory.get('nonexistent')).toBeUndefined();
    });

    it('should manage size correctly', () => {
      const memory = new Memory({ maxShortTermEntries: 3 });
      
      memory.set('k1', 'v1');
      memory.set('k2', 'v2');
      memory.set('k3', 'v3');
      memory.set('k4', 'v4');
      
      expect(memory.size()).toBe(3);
    });

    it('should clear all entries', () => {
      const memory = new Memory();
      
      memory.set('key1', 'value1');
      memory.set('key2', 'value2');
      memory.clear();
      
      expect(memory.size()).toBe(0);
      expect(memory.keys().length).toBe(0);
    });
  });

  describe('SharedMemory', () => {
    it('should create shared memory instance', () => {
      const shared = new SharedMemory();
      
      expect(shared).toBeDefined();
    });

    it('should create multiple sessions', () => {
      const shared = new SharedMemory();
      
      const session1 = shared.createSession('user1');
      const session2 = shared.createSession('user2');
      
      const sessions = shared.getAllSessions();
      expect(sessions.length).toBe(2);
    });

    it('should maintain isolated session data', () => {
      const shared = new SharedMemory();
      
      const session1 = shared.createSession('user1');
      const session2 = shared.createSession('user2');
      
      session1.set('progress', 50);
      session2.set('progress', 80);
      
      expect(session1.get<number>('progress')).toBe(50);
      expect(session2.get<number>('progress')).toBe(80);
    });
  });
});