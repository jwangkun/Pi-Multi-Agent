import vm from 'vm';
import { WorkflowMeta, AgentOpts, AgentSnapshot, WorkflowSnapshot, WorkflowStatus, WorkflowEvent, WorkflowEventCallback } from './types.js';
import { TokenBudget } from './budget.js';
import { parseStructuredOutput } from './structured-output.js';
import type { JSONSchema } from './structured-output.js';
import OpenAI from 'openai';
import { LLM_DEFAULTS } from '../core/llm-config.js';

const FORBIDDEN_GLOBALS = ['Date', 'Math', 'require', 'import', 'process', 'global', 'Buffer', 'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'fetch', 'XMLHttpRequest', 'WebSocket', '__dirname', '__filename'];

export interface RuntimeDeps {
  apiKey: string;
  baseURL?: string;
  model?: string;
  tokenBudget: TokenBudget;
  args?: unknown;
  cwd?: string;
  abortSignal?: AbortSignal;
  maxConcurrentAgents?: number;
  onEvent?: WorkflowEventCallback;
}

let agentCounter = 0;

function nextAgentId(): number {
  return ++agentCounter;
}

export function resetAgentCounter(): void {
  agentCounter = 0;
}

export function extractMeta(source: string): WorkflowMeta {
  const metaMatch = source.match(/export\s+const\s+meta\s*=\s*(\{[\s\S]*?\})\s*(?:\n|$)/);
  if (!metaMatch) {
    throw new SyntaxError('Workflow script must export a `meta` object as the first statement');
  }

  const metaSource = metaMatch[1]!;

  const hasForbidden = FORBIDDEN_GLOBALS.some((g) => {
    const re = new RegExp(`\\b${g}\\b`);
    return re.test(metaSource);
  });

  if (hasForbidden) {
    throw new SyntaxError('`meta` must be a literal object — no function calls, computed keys, template interpolation, or external references');
  }

  try {
    const fn = new Function(`return (${metaSource})`);
    const meta = fn() as WorkflowMeta;

    if (!meta.name || typeof meta.name !== 'string') {
      throw new SyntaxError('meta.name is required and must be a string');
    }
    if (!meta.description || typeof meta.description !== 'string') {
      throw new SyntaxError('meta.description is required and must be a string');
    }
    if (!Array.isArray(meta.phases)) {
      throw new SyntaxError('meta.phases must be an array');
    }

    return meta;
  } catch (err) {
    if (err instanceof SyntaxError) throw err;
    throw new SyntaxError(`Failed to parse meta: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function runWorkflowScript(
  source: string,
  deps: RuntimeDeps
): Promise<{ output: unknown; snapshot: WorkflowSnapshot; totalTokens: number }> {
  const meta = extractMeta(source);
  resetAgentCounter();

  const startTime = Date.now();
  const agents: AgentSnapshot[] = [];
  const logs: string[] = [];
  let currentPhase = meta.phases[0]?.title ?? '';
  let status: WorkflowStatus = 'running';
  let totalTokens = 0;

  const llmClient = new OpenAI({
    apiKey: deps.apiKey,
    baseURL: deps.baseURL || LLM_DEFAULTS.baseURL,
  });
  const model = deps.model || LLM_DEFAULTS.model;
  const maxConcurrent = deps.maxConcurrentAgents || 5;

  const emit = (event: WorkflowEvent) => {
    deps.onEvent?.(event);
  };

  emit({ type: 'workflow:started', meta, timestamp: Date.now() });

  const activeAgents: Set<Promise<unknown>> = new Set();
  const agentQueue: Array<() => Promise<unknown>> = [];

  const drainQueue = async () => {
    while (agentQueue.length > 0 && activeAgents.size < maxConcurrent) {
      const task = agentQueue.shift();
      if (task) {
        const p = task().finally(() => {
          activeAgents.delete(p);
        });
        activeAgents.add(p);
      }
    }
    if (activeAgents.size > 0) {
      await Promise.race(activeAgents);
      await drainQueue();
    }
  };

  const enqueueAgent = (fn: () => Promise<unknown>): Promise<unknown> => {
    return new Promise<unknown>((resolve, reject) => {
      agentQueue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
      drainQueue();
    });
  };

  async function agentImpl(prompt: string, opts?: AgentOpts): Promise<unknown> {
    if (deps.abortSignal?.aborted) {
      throw new Error('Workflow aborted');
    }

    if (deps.tokenBudget.isExhausted()) {
      throw new Error('Token budget exhausted');
    }

    const id = nextAgentId();
    const label = opts?.label || `agent_${id}`;
    const phase = currentPhase;

    const snapshot: AgentSnapshot = {
      id,
      label,
      phase,
      status: 'running',
      startedAt: Date.now(),
    };
    agents.push(snapshot);

    emit({ type: 'agent:started', agentId: id, label, phase, timestamp: Date.now() });

    return enqueueAgent(async () => {
      try {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
          { role: 'user', content: prompt },
        ];

        const maxTokens = opts?.maxTokens || 4096;
        const temperature = opts?.temperature ?? 0.7;

        let responseText = '';
        let tokensUsed = 0;

        if (opts?.schema) {
          const schemaInstruction = buildSchemaInstruction(opts.schema);
          messages.unshift({
            role: 'system',
            content: `You must respond with a valid JSON object matching this schema:\n${schemaInstruction}\n\nRespond ONLY with the JSON object, no other text.`,
          });

          const response = await llmClient.chat.completions.create({
            model,
            messages,
            temperature: 0.3,
            max_tokens: maxTokens,
          });

          tokensUsed = response.usage?.total_tokens ?? 0;
          responseText = response.choices[0]?.message?.content || '';

          const { data, validation } = parseStructuredOutput(responseText, opts.schema);
          if (!validation.valid) {
            const errMsg = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
            snapshot.status = 'failed';
            snapshot.error = errMsg;
            snapshot.completedAt = Date.now();
            emit({ type: 'agent:failed', agentId: id, label, error: errMsg, timestamp: Date.now() });
            throw new Error(`Schema validation failed for agent "${label}": ${errMsg}`);
          }

          totalTokens += tokensUsed;
          deps.tokenBudget.record(tokensUsed);

          snapshot.status = 'completed';
          snapshot.completedAt = Date.now();
          emit({ type: 'agent:completed', agentId: id, label, outputLength: JSON.stringify(data).length, timestamp: Date.now() });

          return data;
        } else {
          const response = await llmClient.chat.completions.create({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
          });

          tokensUsed = response.usage?.total_tokens ?? 0;
          responseText = response.choices[0]?.message?.content || '';

          totalTokens += tokensUsed;
          deps.tokenBudget.record(tokensUsed);

          snapshot.status = 'completed';
          snapshot.completedAt = Date.now();
          emit({ type: 'agent:completed', agentId: id, label, outputLength: responseText.length, timestamp: Date.now() });

          return responseText;
        }
      } catch (err) {
        if (deps.abortSignal?.aborted) {
          snapshot.status = 'skipped';
          snapshot.completedAt = Date.now();
          emit({ type: 'agent:skipped', agentId: id, label, reason: 'aborted', timestamp: Date.now() });
          throw err;
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        snapshot.status = 'failed';
        snapshot.error = errorMsg;
        snapshot.completedAt = Date.now();
        emit({ type: 'agent:failed', agentId: id, label, error: errorMsg, timestamp: Date.now() });
        throw err;
      }
    });
  }

  async function parallelImpl(thunks: Array<() => Promise<unknown>>): Promise<unknown[]> {
    const results = await Promise.allSettled(thunks.map((t) => t()));
    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      throw new Error(`parallel thunk[${i}] failed: ${String(r.reason)}`);
    });
  }

  async function pipelineImpl<T>(
    items: T[],
    ...stages: Array<(prev: unknown, original: T, index: number) => Promise<unknown>>
  ): Promise<unknown[]> {
    return parallelImpl(
      items.map((item, idx) => async () => {
        let prev: unknown = null;
        for (const stage of stages) {
          prev = await stage(prev, item, idx);
        }
        return prev;
      })
    );
  }

  function phaseImpl(title: string): void {
    currentPhase = title;
    emit({ type: 'phase:changed', phase: title, timestamp: Date.now() });
  }

  function logImpl(message: string): void {
    logs.push(message);
    emit({ type: 'workflow:log', message, timestamp: Date.now() });
  }

  const wrappedSource = source
    .replace(/export\s+const\s+meta\s*=\s*/, 'const meta = ')
    .replace(/export\s+default\s+/, '');

  const scriptBody = `
    (async () => {
      ${wrappedSource}
    })()
  `;

  const sandbox: Record<string, unknown> = {
    agent: agentImpl,
    parallel: parallelImpl,
    pipeline: pipelineImpl,
    phase: phaseImpl,
    log: logImpl,
    args: deps.args ?? null,
    cwd: deps.cwd || process.cwd(),
    budget: deps.tokenBudget,
    console: { log: logImpl, warn: logImpl, error: logImpl },
    Promise,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    Error,
    TypeError,
    SyntaxError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    RegExp,
  };

  const context = vm.createContext(sandbox);

  try {
    const script = new vm.Script(scriptBody, { filename: `workflow_${meta.name}.js` });
    const output = await script.runInContext(context, { timeout: 300000 });

    status = 'completed';
    const snapshot: WorkflowSnapshot = {
      meta,
      currentPhase,
      agents,
      logs,
      status,
      startedAt: startTime,
      updatedAt: Date.now(),
    };

    emit({ type: 'workflow:completed', result: { success: true, output, snapshot, totalTokens, totalExecutionTime: Date.now() - startTime }, timestamp: Date.now() });

    return { output, snapshot, totalTokens };
  } catch (err) {
    if (deps.abortSignal?.aborted) {
      status = 'cancelled';
      emit({ type: 'workflow:cancelled', timestamp: Date.now() });
    } else {
      status = 'failed';
      emit({ type: 'workflow:failed', error: err instanceof Error ? err.message : String(err), timestamp: Date.now() });
    }

    const snapshot: WorkflowSnapshot = {
      meta,
      currentPhase,
      agents,
      logs,
      status,
      startedAt: startTime,
      updatedAt: Date.now(),
    };

    return { output: undefined, snapshot, totalTokens };
  }
}

function buildSchemaInstruction(schema: JSONSchema): string {
  return JSON.stringify(schema, null, 2);
}

export function renderSnapshot(snapshot: WorkflowSnapshot): string {
  const lines: string[] = [];
  const completedCount = snapshot.agents.filter((a) => a.status === 'completed').length;
  const totalCount = snapshot.agents.length;

  lines.push(`◆ Workflow: ${snapshot.meta.name} (${completedCount}/${totalCount} done)`);

  const phases = snapshot.meta.phases;
  for (const phase of phases) {
    const phaseAgents = snapshot.agents.filter((a) => a.phase === phase.title);
    const phaseCompleted = phaseAgents.filter((a) => a.status === 'completed').length;
    const phaseIcon = phaseCompleted === phaseAgents.length && phaseAgents.length > 0 ? '✓' : '○';

    lines.push(`  ${phaseIcon} ${phase.title} ${phaseCompleted}/${phaseAgents.length}`);

    for (const agent of phaseAgents) {
      const statusIcon = agent.status === 'completed' ? '✓' : agent.status === 'failed' ? '✗' : agent.status === 'running' ? '⟳' : '○';
      lines.push(`    #${agent.id} ${statusIcon} ${agent.label}`);
    }
  }

  if (snapshot.logs.length > 0) {
    lines.push('');
    for (const log of snapshot.logs) {
      lines.push(`  ℹ ${log}`);
    }
  }

  return lines.join('\n');
}
