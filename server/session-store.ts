import { mkdir, readdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';

export type PersistedSessionStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface PersistedSessionPlan {
  id: string;
  goal: string;
  subTaskCount: number;
  collaborationMode: string;
  communicationStructure?: string;
  executionStrategy?: string;
  subTasks?: Array<{
    id: string;
    title: string;
    description?: string;
    assignedAgentName?: string;
    assignedAgentType?: string;
    assignedAgentPrompt?: string;
    dependencies?: string[];
    priority?: string;
    tools?: string[];
    expectedOutput?: string;
  }>;
  successCriteria?: string[];
  qualityThresholds?: {
    minWordCount: number;
    minSections: number;
    requireDataSupport: boolean;
    requireReferences: boolean;
  };
}

export interface PersistedSessionResult {
  success: boolean;
  finalOutput: string;
  totalExecutionTime: number;
  totalTokensUsed: number;
  evaluationScore: number;
  iterations: number;
  progress?: Array<{
    taskId: string;
    status: string;
    progress: number;
    outputLength?: number;
    error?: string;
  }>;
  error?: string;
}

export interface PersistedWorkflowResult {
  success: boolean;
  output: unknown;
  totalTokens: number;
  totalExecutionTime: number;
  snapshot?: unknown;
  error?: string;
}

export interface PersistedSessionSnapshot {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: PersistedSessionStatus;
  mode?: string;
  task?: string;
  plan?: PersistedSessionPlan;
  result?: PersistedSessionResult;
  workflowResult?: PersistedWorkflowResult;
  error?: string;
}

export interface PersistedSessionSummary {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: PersistedSessionStatus;
  mode?: string;
  task?: string;
  finalOutputLength: number;
  evaluationScore?: number;
  iterations?: number;
  error?: string;
}

export interface ExpireStaleRunningSessionsOptions {
  now?: number;
  timeoutMs: number;
  error: string;
}

export function getDefaultSessionDataDir(): string {
  return path.resolve(process.env.PI_MULTI_AGENT_DATA_DIR || path.join(process.cwd(), '.pi-multi-agent', 'sessions'));
}

export class FileSessionStore {
  private readonly sessions = new Map<string, PersistedSessionSnapshot>();

  constructor(private readonly dataDir: string = getDefaultSessionDataDir()) {}

  async load(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const files = await readdir(this.dataDir);

    this.sessions.clear();
    await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => {
          try {
            const content = await readFile(path.join(this.dataDir, file), 'utf-8');
            const snapshot = JSON.parse(content) as PersistedSessionSnapshot;
            if (this.isValidSnapshot(snapshot)) {
              this.sessions.set(snapshot.id, snapshot);
            }
          } catch {
            // Ignore invalid session files so one corrupted file does not break startup.
          }
        })
    );
  }

  getSession(id: string): PersistedSessionSnapshot | undefined {
    return this.sessions.get(id);
  }

  listSessions(): PersistedSessionSummary[] {
    return Array.from(this.sessions.values())
      .map((snapshot) => ({
        id: snapshot.id,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
        status: snapshot.status,
        mode: snapshot.mode,
        task: snapshot.task,
        finalOutputLength: this.getFinalOutputLength(snapshot),
        evaluationScore: snapshot.result?.evaluationScore,
        iterations: snapshot.result?.iterations,
        error: snapshot.error,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async saveSession(snapshot: PersistedSessionSnapshot): Promise<void> {
    const normalized = {
      ...snapshot,
      updatedAt: snapshot.updatedAt || Date.now(),
    };
    this.sessions.set(normalized.id, normalized);
    await this.writeSnapshot(normalized);
  }

  async patchSession(id: string, patch: Partial<Omit<PersistedSessionSnapshot, 'id' | 'createdAt'>>): Promise<PersistedSessionSnapshot> {
    const existing = this.sessions.get(id);
    if (!existing) {
      throw new Error(`Session ${id} not found`);
    }

    const next: PersistedSessionSnapshot = {
      ...existing,
      ...patch,
      updatedAt: patch.updatedAt || Date.now(),
    };
    await this.saveSession(next);
    return next;
  }

  async expireStaleRunningSessions(options: ExpireStaleRunningSessionsOptions): Promise<PersistedSessionSnapshot[]> {
    const now = options.now ?? Date.now();
    const expired: PersistedSessionSnapshot[] = [];

    for (const snapshot of this.sessions.values()) {
      if (snapshot.status !== 'running') continue;
      if (now - snapshot.updatedAt <= options.timeoutMs) continue;

      const next = await this.patchSession(snapshot.id, {
        status: 'failed',
        error: options.error,
        updatedAt: now,
      });
      expired.push(next);
    }

    return expired;
  }

  private async writeSnapshot(snapshot: PersistedSessionSnapshot): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const filePath = this.getFilePath(snapshot.id);
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
    await rename(tmpPath, filePath);
  }

  private getFilePath(id: string): string {
    return path.join(this.dataDir, `${encodeURIComponent(id)}.json`);
  }

  private getFinalOutputLength(snapshot: PersistedSessionSnapshot): number {
    if (snapshot.result?.finalOutput) return snapshot.result.finalOutput.length;
    if (typeof snapshot.workflowResult?.output === 'string') return snapshot.workflowResult.output.length;
    return 0;
  }

  private isValidSnapshot(value: PersistedSessionSnapshot): boolean {
    return Boolean(
      value &&
        typeof value.id === 'string' &&
        typeof value.createdAt === 'number' &&
        typeof value.updatedAt === 'number' &&
        ['idle', 'running', 'completed', 'failed'].includes(value.status)
    );
  }
}
