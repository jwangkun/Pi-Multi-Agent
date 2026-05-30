import {
  MemoryEntry,
  SessionContext,
  SessionId,
  AgentId,
  TaskId,
  TaskResult,
} from '../core/types.js';
import { MemoryError } from '../core/errors.js';

let sessionIdCounter = 0;

function generateSessionId(): SessionId {
  return `session_${Date.now()}_${++sessionIdCounter}` as SessionId;
}

export interface MemoryConfig {
  maxShortTermEntries?: number;
  maxLongTermEntries?: number;
  defaultTTL?: number;
  enableAutoCleanup?: boolean;
  cleanupIntervalMs?: number;
}

export class ShortTermMemory {
  private entries: Map<string, MemoryEntry> = new Map();
  private maxEntries: number;
  private accessOrder: string[] = [];

  constructor(maxEntries: number = 100) {
    this.maxEntries = maxEntries;
  }

  set(key: string, value: unknown, ttl?: number, tags?: string[], source?: AgentId): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      this.evictLeastRecentlyUsed();
    }

    const entry: MemoryEntry = {
      key,
      value,
      timestamp: Date.now(),
      ttl,
      tags,
      source,
      accessCount: 0,
    };

    this.entries.set(key, entry);
    this.updateAccessOrder(key);
  }

  get(key: string): unknown | undefined {
    const entry = this.entries.get(key);
    
    if (!entry) {
      return undefined;
    }

    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.entries.delete(key);
      this.removeFromAccessOrder(key);
      return undefined;
    }

    entry.accessCount++;
    this.updateAccessOrder(key);

    return entry.value;
  }

  has(key: string): boolean {
    const entry = this.entries.get(key);
    
    if (!entry) {
      return false;
    }

    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.entries.delete(key);
      this.removeFromAccessOrder(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    const deleted = this.entries.delete(key);
    if (deleted) {
      this.removeFromAccessOrder(key);
    }
    return deleted;
  }

  clear(): void {
    this.entries.clear();
    this.accessOrder = [];
  }

  keys(): string[] {
    return Array.from(this.entries.keys());
  }

  size(): number {
    return this.entries.size;
  }

  private evictLeastRecentlyUsed(): void {
    if (this.accessOrder.length > 0) {
      const lruKey = this.accessOrder.shift();
      if (lruKey) {
        this.entries.delete(lruKey);
      }
    }
  }

  private updateAccessOrder(key: string): void {
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  getRecentEntries(count: number = 10): MemoryEntry[] {
    const entries = Array.from(this.entries.values());
    return entries
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, count);
  }

  getByTag(tag: string): MemoryEntry[] {
    const results: MemoryEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.tags?.includes(tag)) {
        results.push(entry);
      }
    }
    return results;
  }
}

export interface VectorStoreEntry {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface VectorStoreConfig {
  dimension: number;
  metric?: 'cosine' | 'euclidean' | 'dotproduct';
}

export class LongTermMemory {
  private vectors: Map<string, VectorStoreEntry> = new Map();
  private metadata: Map<string, unknown> = new Map();
  private dimension: number;
  private metric: 'cosine' | 'euclidean' | 'dotproduct';

  constructor(config: VectorStoreConfig) {
    this.dimension = config.dimension;
    this.metric = config.metric ?? 'cosine';
  }

  async add(
    id: string,
    vector: number[],
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    if (vector.length !== this.dimension) {
      throw new MemoryError(
        `Vector dimension mismatch. Expected ${this.dimension}, got ${vector.length}`
      );
    }

    this.vectors.set(id, { id, vector, metadata });
    this.metadata.set(id, metadata);
  }

  async search(query: number[], topK: number = 10): Promise<Array<{ id: string; score: number; metadata: Record<string, unknown> }>> {
    if (query.length !== this.dimension) {
      throw new MemoryError(
        `Query vector dimension mismatch. Expected ${this.dimension}, got ${query.length}`
      );
    }

    const results: Array<{ id: string; score: number; metadata: Record<string, unknown> }> = [];

    for (const [id, entry] of this.vectors) {
      const score = this.calculateSimilarity(query, entry.vector);
      results.push({
        id,
        score,
        metadata: entry.metadata,
      });
    }

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
  }

  async get(id: string): Promise<VectorStoreEntry | undefined> {
    return this.vectors.get(id);
  }

  async delete(id: string): Promise<boolean> {
    const deleted = this.vectors.delete(id);
    this.metadata.delete(id);
    return deleted;
  }

  async clear(): Promise<void> {
    this.vectors.clear();
    this.metadata.clear();
  }

  size(): number {
    return this.vectors.size;
  }

  private calculateSimilarity(a: number[], b: number[]): number {
    switch (this.metric) {
      case 'cosine':
        return this.cosineSimilarity(a, b);
      case 'euclidean':
        return -this.euclideanDistance(a, b);
      case 'dotproduct':
        return this.dotProduct(a, b);
      default:
        return this.cosineSimilarity(a, b);
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dotProduct += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      const diff = ai - bi;
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  private dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      sum += ai * bi;
    }
    return sum;
  }
}

export class Memory {
  private shortTerm: ShortTermMemory;
  private longTerm?: LongTermMemory;
  private sessionId: SessionId;
  private userId?: string;
  private metadata: Record<string, unknown>;
  private createdAt: number;
  private lastAccessedAt: number;
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(config: MemoryConfig = {}) {
    this.shortTerm = new ShortTermMemory(config.maxShortTermEntries ?? 100);
    this.sessionId = generateSessionId();
    this.metadata = {};
    this.createdAt = Date.now();
    this.lastAccessedAt = Date.now();

    if (config.maxLongTermEntries && config.maxLongTermEntries > 0) {
      this.longTerm = new LongTermMemory({
        dimension: 1536,
        metric: 'cosine',
      });
    }

    if (config.enableAutoCleanup) {
      this.startAutoCleanup(config.cleanupIntervalMs ?? 60000);
    }
  }

  getSessionId(): SessionId {
    return this.sessionId;
  }

  setUserId(userId: string): void {
    this.userId = userId;
  }

  getUserId(): string | undefined {
    return this.userId;
  }

  set(key: string, value: unknown, options?: { ttl?: number; tags?: string[]; source?: AgentId; longTerm?: boolean }): void {
    this.shortTerm.set(key, value, options?.ttl, options?.tags, options?.source);
    this.updateLastAccessed();
  }

  get<T = unknown>(key: string): T | undefined {
    this.updateLastAccessed();
    return this.shortTerm.get(key) as T | undefined;
  }

  has(key: string): boolean {
    return this.shortTerm.has(key);
  }

  delete(key: string): boolean {
    return this.shortTerm.delete(key);
  }

  clear(): void {
    this.shortTerm.clear();
  }

  keys(): string[] {
    return this.shortTerm.keys();
  }

  size(): number {
    return this.shortTerm.size();
  }

  async addLongTermMemory(
    id: string,
    vector: number[],
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    if (!this.longTerm) {
      throw new MemoryError('Long-term memory not enabled');
    }
    await this.longTerm.add(id, vector, metadata);
  }

  async searchLongTermMemory(
    query: number[],
    topK: number = 10
  ): Promise<Array<{ id: string; score: number; metadata: Record<string, unknown> }>> {
    if (!this.longTerm) {
      throw new MemoryError('Long-term memory not enabled');
    }
    return this.longTerm.search(query, topK);
  }

  storeTaskResult(taskId: TaskId, result: TaskResult, context?: Record<string, unknown>): void {
    const entry = {
      taskId,
      result,
      context,
      timestamp: Date.now(),
    };

    this.set(`task_result_${taskId as string}`, entry, {
      tags: ['task_result', 'history'],
    });
  }

  getTaskResult(taskId: TaskId): (TaskResult & { context?: Record<string, unknown>; timestamp: number }) | undefined {
    return this.get(`task_result_${taskId as string}`);
  }

  getRecentTasks(count: number = 10): Array<{ taskId: TaskId; timestamp: number }> {
    const entries = this.shortTerm.getRecentEntries(count * 2);
    const taskResults: Array<{ taskId: TaskId; timestamp: number }> = [];

    for (const entry of entries) {
      if (entry.key.startsWith('task_result_')) {
        const taskResult = entry.value as { taskId: TaskId; timestamp: number };
        taskResults.push({
          taskId: taskResult.taskId,
          timestamp: entry.timestamp,
        });
      }
    }

    return taskResults.slice(0, count);
  }

  storeContext(key: string, value: unknown): void {
    this.metadata[key] = value;
    this.set(`context_${key}`, value, { tags: ['context'] });
  }

  getContext<T = unknown>(key: string): T | undefined {
    return this.get<T>(`context_${key}`);
  }

  getSessionInfo(): SessionContext {
    return {
      id: this.sessionId,
      userId: this.userId,
      createdAt: this.createdAt,
      lastAccessedAt: this.lastAccessedAt,
      metadata: { ...this.metadata },
      shortTermMemory: new Map(),
      longTermMemory: undefined,
    };
  }

  private updateLastAccessed(): void {
    this.lastAccessedAt = Date.now();
  }

  private startAutoCleanup(intervalMs: number): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, intervalMs);
  }

  stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  private cleanup(): void {
    const entries = this.shortTerm.getRecentEntries(this.shortTerm.size());
    for (const entry of entries) {
      if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
        this.shortTerm.delete(entry.key);
      }
    }
  }
}

export class SharedMemory {
  private sessions: Map<SessionId, Memory> = new Map();

  createSession(userId?: string): Memory {
    const memory = new Memory();
    memory.setUserId(userId ?? '');
    this.sessions.set(memory.getSessionId(), memory);
    return memory;
  }

  getSession(sessionId: SessionId): Memory | undefined {
    return this.sessions.get(sessionId);
  }

  deleteSession(sessionId: SessionId): boolean {
    const memory = this.sessions.get(sessionId);
    if (memory) {
      memory.stopAutoCleanup();
      return this.sessions.delete(sessionId);
    }
    return false;
  }

  getAllSessions(): SessionId[] {
    return Array.from(this.sessions.keys());
  }

  clearAll(): void {
    for (const memory of this.sessions.values()) {
      memory.stopAutoCleanup();
    }
    this.sessions.clear();
  }
}
