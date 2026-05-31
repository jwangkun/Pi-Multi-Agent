import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSessionStore, type PersistedSessionSnapshot } from './session-store';

const tempDirs: string[] = [];

async function createTempStore() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pi-session-store-'));
  tempDirs.push(dataDir);
  const store = new FileSessionStore(dataDir);
  await store.load();
  return { dataDir, store };
}

function sessionSnapshot(overrides: Partial<PersistedSessionSnapshot> = {}): PersistedSessionSnapshot {
  return {
    id: 'session-1',
    createdAt: 1_000,
    updatedAt: 1_000,
    status: 'completed',
    mode: 'deep',
    task: 'Write a market report',
    plan: {
      id: 'plan-1',
      goal: 'Write a market report',
      subTaskCount: 1,
      collaborationMode: 'parallel',
      subTasks: [
        {
          id: 'task-1',
          title: 'Research',
          assignedAgentName: 'Researcher',
          assignedAgentType: 'research',
          dependencies: [],
          priority: 'high',
          tools: ['web_search'],
        },
      ],
    },
    result: {
      success: true,
      finalOutput: 'Final report body',
      totalExecutionTime: 1234,
      totalTokensUsed: 5678,
      evaluationScore: 0.92,
      iterations: 2,
      progress: [
        {
          taskId: 'task-1',
          status: 'completed',
          progress: 100,
          outputLength: 17,
        },
      ],
    },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('FileSessionStore', () => {
  it('loads a saved session after a new store instance is created', async () => {
    const { dataDir, store } = await createTempStore();
    const snapshot = sessionSnapshot();

    await store.saveSession(snapshot);

    const restartedStore = new FileSessionStore(dataDir);
    await restartedStore.load();

    expect(restartedStore.getSession(snapshot.id)).toEqual(snapshot);
  });

  it('lists session summaries by most recently updated first', async () => {
    const { store } = await createTempStore();
    await store.saveSession(sessionSnapshot({ id: 'old-session', updatedAt: 2_000, task: 'Old task' }));
    await store.saveSession(sessionSnapshot({ id: 'new-session', updatedAt: 4_000, task: 'New task' }));

    expect(store.listSessions()).toEqual([
      expect.objectContaining({ id: 'new-session', task: 'New task', finalOutputLength: 17 }),
      expect.objectContaining({ id: 'old-session', task: 'Old task', finalOutputLength: 17 }),
    ]);
  });

  it('keeps full output in the detail view instead of session summaries', async () => {
    const { store } = await createTempStore();
    await store.saveSession(sessionSnapshot({ result: { ...sessionSnapshot().result!, finalOutput: 'x'.repeat(20_000) } }));

    const [summary] = store.listSessions();

    expect(summary).not.toHaveProperty('finalOutput');
    expect(summary?.finalOutputLength).toBe(20_000);
    expect(store.getSession('session-1')?.result?.finalOutput).toHaveLength(20_000);
  });

  it('marks stale running sessions as failed when they stop updating', async () => {
    const { dataDir, store } = await createTempStore();
    await store.saveSession(sessionSnapshot({
      id: 'stale-session',
      status: 'running',
      updatedAt: 10_000,
      result: undefined,
    }));

    await store.expireStaleRunningSessions({
      now: 30_001,
      timeoutMs: 20_000,
      error: 'Execution timed out without progress',
    });

    const restartedStore = new FileSessionStore(dataDir);
    await restartedStore.load();

    expect(restartedStore.getSession('stale-session')).toEqual(expect.objectContaining({
      status: 'failed',
      error: 'Execution timed out without progress',
      updatedAt: 30_001,
    }));
  });

  it('keeps recently updated running sessions active', async () => {
    const { store } = await createTempStore();
    await store.saveSession(sessionSnapshot({
      id: 'fresh-session',
      status: 'running',
      updatedAt: 25_000,
      result: undefined,
    }));

    await store.expireStaleRunningSessions({
      now: 30_000,
      timeoutMs: 20_000,
      error: 'Execution timed out without progress',
    });

    expect(store.getSession('fresh-session')).toEqual(expect.objectContaining({
      status: 'running',
      updatedAt: 25_000,
    }));
  });
});
