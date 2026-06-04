import OpenAI from 'openai';
import { WorkflowConfig, WorkflowResult, WorkflowEvent, WorkflowEventCallback, WorkflowMeta } from './types.js';
import { TokenBudget } from './budget.js';
import { runWorkflowScript, extractMeta, renderSnapshot } from './runtime.js';
import { LLM_DEFAULTS } from '../core/llm-config.js';

const WORKFLOW_SYSTEM_PROMPT = `You are a workflow script generator. Given a user's task description, you generate a JavaScript workflow script that orchestrates multiple sub-agents to complete the task.

The script MUST follow this exact structure:

1. First statement: export a literal meta object
2. Use phase() to mark phases
3. Use agent() to spawn sub-agents
4. Use parallel() for concurrent work
5. Use pipeline() for per-item fan-out with sequential stages
6. Return the final result

Available globals:
- agent(prompt, opts?) — Spawn an isolated subagent. Returns its final text, or with opts.schema, a validated object.
  - opts.label: string — display name for the agent
  - opts.schema: JSON Schema object — for structured output
  - opts.maxTokens: number — max output tokens
  - opts.temperature: number — sampling temperature
- parallel(thunks) — Run an array of () => agent(...) thunks concurrently. Results returned in input order.
- pipeline(items, ...stages) — Run each item through sequential stages while items fan out. Each stage receives (prev, original, index).
- phase(title) — Mark the current phase. Used for grouping in the live progress view.
- log(message) — Append a workflow-level log line.
- args — Optional JSON value passed in via the tool's args parameter.
- cwd — Current working directory for subagents.
- budget — { total, spent(), remaining() } token budget tracker.

Determinism rules (these are intentionally unavailable):
- Date.now(), new Date()
- Math.random()
- require, import, fs, network APIs
- Spreads, computed keys, template interpolation, function calls inside meta

Example workflow script:

export const meta = {
  name: 'inspect_project',
  description: 'Inspect a repository and summarize the main modules',
  phases: [
    { title: 'Scan' },
    { title: 'Analyze' },
  ],
}

phase('Scan')
const inventory = await agent('Inspect the repository structure.', {
  label: 'repo inventory',
})

phase('Analyze')
const summary = await agent(
  'Summarize the main modules from this inventory:\\n' + inventory,
  { label: 'module summary' },
)

return { inventory, summary }

IMPORTANT:
- meta MUST be a literal object (no computed keys, no function calls, no template literals)
- meta.phases MUST be an array of { title: string } objects
- The script MUST use await for agent(), parallel(), and pipeline()
- Return the final result at the end
- Generate ONLY the script code, no markdown fences, no explanation`;

export class DynamicWorkflow {
  private llmClient: OpenAI;
  private apiKey: string;
  private baseURL: string;
  private model: string;
  private defaultTokenBudget: number;
  private maxConcurrentAgents: number;
  private eventCallbacks: WorkflowEventCallback[] = [];

  constructor(config: WorkflowConfig) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || LLM_DEFAULTS.baseURL;
    this.model = config.model || LLM_DEFAULTS.model;
    this.defaultTokenBudget = config.tokenBudget || 200000;
    this.maxConcurrentAgents = config.maxConcurrentAgents || 5;
    this.llmClient = new OpenAI({ apiKey: config.apiKey, baseURL: this.baseURL });
  }

  onEvent(callback: WorkflowEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  async run(taskDescription: string, args?: unknown): Promise<WorkflowResult> {
    const script = await this.generateScript(taskDescription);
    return this.executeScript(script, args);
  }

  async generateScript(taskDescription: string): Promise<string> {
    const response = await this.llmClient.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: WORKFLOW_SYSTEM_PROMPT },
        { role: 'user', content: taskDescription },
      ],
      temperature: 0.3,
      max_tokens: 4096,
    });

    let script = response.choices[0]?.message?.content || '';

    script = script
      .replace(/^```(?:javascript|js)?\s*\n?/m, '')
      .replace(/\n?```\s*$/m, '')
      .trim();

    extractMeta(script);

    return script;
  }

  async executeScript(script: string, args?: unknown, abortSignal?: AbortSignal): Promise<WorkflowResult> {
    const budget = new TokenBudget(this.defaultTokenBudget);
    const startTime = Date.now();

    const emit = (event: WorkflowEvent) => {
      for (const cb of this.eventCallbacks) {
        try { cb(event); } catch {}
      }
    };

    const { output, snapshot, totalTokens } = await runWorkflowScript(script, {
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      model: this.model,
      tokenBudget: budget,
      args,
      cwd: process.cwd(),
      abortSignal,
      maxConcurrentAgents: this.maxConcurrentAgents,
      onEvent: emit,
    });

    const success = snapshot.status === 'completed';

    return {
      success,
      output,
      snapshot,
      totalTokens,
      totalExecutionTime: Date.now() - startTime,
    };
  }

  async validateScript(script: string): Promise<{ valid: boolean; meta?: WorkflowMeta; error?: string }> {
    try {
      const meta = extractMeta(script);
      return { valid: true, meta };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  static renderSnapshot(snapshot: Parameters<typeof renderSnapshot>[0]): string {
    return renderSnapshot(snapshot);
  }
}
