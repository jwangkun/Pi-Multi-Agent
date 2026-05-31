import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '..', '.env'),
];
for (const envPath of envPaths) {
  try {
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      process.env[key] = value;
    }
    break;
  } catch {}
}

import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import {
  Agent,
  AgentConfig,
  AgentExecutor,
  AgentContext,
  SessionId,
  TaskId,
  SequentialHandoffs,
  ParallelProcessing,
  ExpertTeam,
  Orchestrator,
  Memory,
  SharedMemory,
} from '../src/index.js';
import { DeepPlanner, DeepPlan, SubTask } from '../src/orchestration/deep-planner.js';
import { AgentCluster, ClusterEvent, ClusterExecutionResult, AgentClusterProgress } from '../src/orchestration/agent-cluster.js';
import { LLMAgentCollaboration } from '../src/collaboration/llm-collaboration.js';
import { DynamicWorkflow } from '../src/workflow/index.js';
import type { WorkflowEvent, WorkflowResult } from '../src/workflow/types.js';
import {
  FileSessionStore,
  getDefaultSessionDataDir,
  type PersistedSessionPlan,
  type PersistedSessionResult,
  type PersistedWorkflowResult,
} from './session-store.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

const deepseekClient = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

interface ActiveSession {
  id: string;
  agents: Map<string, Agent>;
  memory: Memory;
  sharedMemory: SharedMemory;
  orchestrator?: Orchestrator;
  ws?: WebSocket;
  cluster?: AgentCluster;
  currentPlan?: DeepPlan;
  executionResult?: ClusterExecutionResult;
  workflow?: DynamicWorkflow;
  workflowResult?: WorkflowResult;
}

const sessions = new Map<string, ActiveSession>();
const sessionStore = new FileSessionStore(getDefaultSessionDataDir());
const RUNNING_SESSION_TIMEOUT_MS = Number(process.env.PI_MULTI_AGENT_RUNNING_SESSION_TIMEOUT_MS || 10 * 60 * 1000);
const STALE_RUNNING_SESSION_ERROR = 'Execution timed out without progress';

function toPersistedPlan(plan: DeepPlan): PersistedSessionPlan {
  return {
    id: plan.id,
    goal: plan.goal,
    subTaskCount: plan.subTasks.length,
    collaborationMode: plan.collaborationMode,
    communicationStructure: plan.communicationStructure,
    executionStrategy: plan.executionStrategy,
    subTasks: plan.subTasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      assignedAgentName: task.assignedAgentName,
      assignedAgentType: task.assignedAgentType,
      assignedAgentPrompt: task.assignedAgentPrompt,
      dependencies: task.dependencies,
      priority: task.priority,
      tools: task.tools,
      expectedOutput: task.expectedOutput,
    })),
    successCriteria: plan.successCriteria,
    qualityThresholds: plan.qualityThresholds,
  };
}

function toPersistedClusterResult(result: ClusterExecutionResult): PersistedSessionResult {
  return {
    success: result.success,
    finalOutput: result.finalOutput,
    totalExecutionTime: result.totalExecutionTime,
    totalTokensUsed: result.totalTokensUsed,
    evaluationScore: result.evaluationScore,
    iterations: result.iterations,
    progress: result.progress.map((item) => ({
      taskId: item.taskId,
      status: item.status,
      progress: item.progress,
      outputLength: item.outputLength,
      error: item.error,
    })),
  };
}

function toPersistedWorkflowResult(result: WorkflowResult): PersistedWorkflowResult {
  return {
    success: result.success,
    output: result.output,
    totalTokens: result.totalTokens,
    totalExecutionTime: result.totalExecutionTime,
    snapshot: result.snapshot,
  };
}

async function markPersistedSessionFailed(sessionId: string, error: unknown): Promise<void> {
  try {
    await sessionStore.patchSession(sessionId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  } catch {
    // Avoid hiding the original API error behind a persistence failure.
  }
}

async function expireStaleRunningSessions(): Promise<void> {
  await sessionStore.expireStaleRunningSessions({
    timeoutMs: RUNNING_SESSION_TIMEOUT_MS,
    error: STALE_RUNNING_SESSION_ERROR,
  });
}

function isExecutionActive(sessionId: string): boolean {
  const persisted = sessionStore.getSession(sessionId);
  return Boolean(sessions.has(sessionId) && persisted?.status === 'running');
}

function createDeepSeekExecutor(sessionId: string): AgentExecutor {
  return {
    async execute(prompt: string, context: AgentContext): Promise<{ text: string }> {
      const agentName = (context.metadata?.['agentName'] as string) || 'Agent';
      const session = sessions.get(sessionId);

      if (session?.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(
          JSON.stringify({
            type: 'agent_thinking',
            agentId: context.metadata?.['agentId'],
            agentName,
            taskId: context.taskId,
          })
        );
      }

      try {
        const response = await deepseekClient.chat.completions.create({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: `你是${agentName}。请用中文回答，提供详细、专业、有数据支撑的分析。输出至少2000字。`,
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 4096,
        });

        const text = response.choices[0]?.message?.content || '无响应';

        if (session?.ws && session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(
            JSON.stringify({
              type: 'agent_response',
              agentId: context.metadata?.['agentId'],
              agentName,
              taskId: context.taskId,
              text,
              tokenUsage: response.usage
                ? {
                    prompt: response.usage.prompt_tokens,
                    completion: response.usage.completion_tokens,
                    total: response.usage.total_tokens,
                  }
                : undefined,
            })
          );
        }

        return { text };
      } catch (error: any) {
        if (session?.ws && session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(
            JSON.stringify({
              type: 'agent_error',
              agentId: context.metadata?.['agentId'],
              agentName,
              error: error.message,
            })
          );
        }
        throw error;
      }
    },
  };
}

const AGENT_TEMPLATES: Record<
  string,
  { name: string; description: string; systemPrompt: string; capabilities: string[] }
> = {
  researcher: {
    name: '市场研究员',
    description: '负责市场调研、信息收集和趋势分析',
    systemPrompt:
      '你是资深市场研究员，擅长收集市场数据、分析竞争对手、识别市场趋势。请用数据支撑你的分析，回答简洁专业。',
    capabilities: ['research', 'analysis', 'market-intelligence'],
  },
  analyst: {
    name: '数据分析专家',
    description: '负责数据分析、统计和可视化建议',
    systemPrompt:
      '你是数据分析专家，擅长市场份额分析、用户画像分析、ROI计算。请用具体数字和百分比说明。',
    capabilities: ['data-analysis', 'statistics', 'visualization'],
  },
  writer: {
    name: '报告撰写专家',
    description: '负责整合信息、撰写专业报告',
    systemPrompt:
      '你是专业报告撰写专家，擅长整合多方信息，撰写结构清晰、逻辑严密的报告。',
    capabilities: ['writing', 'editing', 'summarization'],
  },
  critic: {
    name: '质量审核专家',
    description: '负责审核内容质量、提出改进建议',
    systemPrompt:
      '你是严谨的质量审核专家，擅长评估内容的完整性、准确性和逻辑性，并提出具体改进建议。',
    capabilities: ['review', 'quality-assurance', 'feedback'],
  },
  coder: {
    name: '技术工程师',
    description: '负责技术实现和代码开发',
    systemPrompt:
      '你是资深技术工程师，擅长系统设计、代码开发和架构优化。请给出具体的技术方案。',
    capabilities: ['coding', 'architecture', 'technical-design'],
  },
  strategist: {
    name: '战略顾问',
    description: '负责战略规划和决策建议',
    systemPrompt:
      '你是经验丰富的战略顾问，擅长战略规划、竞争分析和投资建议。请给出有深度的战略洞察。',
    capabilities: ['strategy', 'planning', 'decision-making'],
  },
};

app.get('/api/sessions', async (_req, res) => {
  await expireStaleRunningSessions();
  res.json({ sessions: sessionStore.listSessions() });
});

app.post('/api/sessions', async (_req, res) => {
  const sessionId = uuidv4();
  const now = Date.now();
  const session: ActiveSession = {
    id: sessionId,
    agents: new Map(),
    memory: new Memory({ maxShortTermEntries: 100 }),
    sharedMemory: new SharedMemory(),
  };
  sessions.set(sessionId, session);
  await sessionStore.saveSession({
    id: sessionId,
    createdAt: now,
    updatedAt: now,
    status: 'idle',
  });
  res.json({ sessionId, message: 'Session created' });
});

app.get('/api/sessions/:sessionId', async (req, res) => {
  await expireStaleRunningSessions();
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  const persisted = sessionStore.getSession(sessionId);

  if (!session && !persisted) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json({
    session: persisted || {
      id: sessionId,
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    active: isExecutionActive(sessionId),
  });
});

app.post('/api/analyze-complexity', async (req, res) => {
  const { task } = req.body;
  if (!task) {
    res.status(400).json({ error: 'task is required' });
    return;
  }

  try {
    const response = await deepseekClient.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `You are a task complexity analyzer for a multi-agent system. Analyze the given task and return a JSON object with these fields:
- "level": one of "simple", "medium", "complex", "deep"
- "agentCount": recommended number of agents (1 for simple, 2-3 for medium, 4-6 for complex, 7-10 for deep)
- "mode": recommended collaboration mode ("direct", "sequential", "parallel", "expert_team", "deep")
- "reasoning": brief explanation of the complexity assessment

Rules:
- Simple greetings, single questions, basic calculations → "simple" (1 agent, "direct")
- Tasks requiring 2-3 steps, basic analysis, short writing → "medium" (2-3 agents, "sequential" or "parallel")
- Multi-domain analysis, comparative studies, medium-length reports → "complex" (4-6 agents, "expert_team")
- Comprehensive research, deep analysis, long-form reports (10000+ words) → "deep" (7-10 agents, "deep")

Return ONLY the JSON object, no other text.`,
        },
        { role: 'user', content: task },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || '';
    let analysis;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { level: 'simple', agentCount: 1, mode: 'direct', reasoning: 'Default to simple' };
    } catch {
      analysis = { level: 'simple', agentCount: 1, mode: 'direct', reasoning: 'Failed to parse analysis' };
    }

    const validLevels = ['simple', 'medium', 'complex', 'deep'];
    const validModes = ['direct', 'sequential', 'parallel', 'expert_team', 'deep'];
    if (!validLevels.includes(analysis.level)) analysis.level = 'simple';
    if (!validModes.includes(analysis.mode)) analysis.mode = 'direct';
    if (typeof analysis.agentCount !== 'number' || analysis.agentCount < 1) analysis.agentCount = 1;
    if (!analysis.reasoning) analysis.reasoning = 'Auto-assessed';

    res.json(analysis);
  } catch (error: any) {
    console.error('Complexity analysis error:', error.message);
    res.json({ level: 'simple', agentCount: 1, mode: 'direct', reasoning: 'Fallback: analysis failed' });
  }
});

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    const response = await deepseekClient.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are a helpful AI assistant. Respond concisely and accurately.' },
        { role: 'user', content: message },
      ],
      temperature: 0.7,
      max_tokens: 2048,
    });

    const output = response.choices[0]?.message?.content || '';
    const tokens = response.usage?.total_tokens || 0;

    res.json({ output, tokens, success: true });
  } catch (error: any) {
    console.error('Chat error:', error.message);
    res.status(500).json({ error: error.message || 'Chat failed' });
  }
});

app.post('/api/clarify', async (req, res) => {
  const { task } = req.body;
  if (!task) {
    res.status(400).json({ error: 'task is required' });
    return;
  }

  try {
    const response = await deepseekClient.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `You are a task clarification analyzer for a multi-agent AI system. Your job is to determine if the user's task needs clarification before execution.

Analyze the task and return a JSON object with these fields:
- "needsClarification": boolean - whether the task needs user input before proceeding
- "reason": string - brief explanation of why clarification is/isn't needed
- "clarification": if needsClarification is true, provide an object with:
  - "taskId": unique string ID
  - "stepId": "clarify-1"
  - "status": "WAITING_INPUT"
  - "uiSchema": object describing the form to show the user
  - "contextHint": string explaining why we need this info
  - "defaultValues": object with any pre-filled values from context

The uiSchema must follow this structure:
{
  "type": "form" | "confirm-card" | "selection-list",
  "title": string,
  "description": string,
  "fields": array of field objects,
  "actions": array of action button objects
}

Each field object:
{
  "key": string (unique identifier),
  "label": string (display label),
  "type": "text" | "number" | "date" | "select" | "textarea",
  "required": boolean,
  "placeholder": string (optional),
  "options": array of {label, value} (only for select type)
}

Each action button:
{
  "key": string,
  "label": string,
  "variant": "primary" | "secondary" | "danger",
  "submit": boolean
}

Rules:
- Simple greetings, clear single questions, well-defined tasks → needsClarification: false
- Vague tasks like "帮我写个报告" → needsClarification: true, ask about topic, scope, format
- Research tasks without specific domain → ask about industry, region, time period
- Writing tasks without style/tone specified → ask about audience, tone, length
- Tasks with ambiguous scope → ask about depth, format, focus areas
- Keep fields minimal (2-5 fields max), only ask for truly missing critical info
- Always include a "submit" action button with variant "primary"
- For selection-list type, use select fields with options

Return ONLY valid JSON, no other text.`,
        },
        { role: 'user', content: task },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    const content = response.choices[0]?.message?.content || '';
    let result;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { needsClarification: false, reason: 'Parse failed' };
    } catch {
      result = { needsClarification: false, reason: 'Parse failed' };
    }

    res.json(result);
  } catch (error: any) {
    console.error('Clarify error:', error.message);
    res.json({ needsClarification: false, reason: 'Clarification analysis failed' });
  }
});

app.post('/api/sessions/:sessionId/agents', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { template, customName, customPrompt, customCapabilities } = req.body;

  let config: AgentConfig;
  let capabilities: string[];

  if (template && AGENT_TEMPLATES[template]) {
    const tmpl = AGENT_TEMPLATES[template];
    config = {
      name: tmpl.name,
      description: tmpl.description,
      systemPrompt: tmpl.systemPrompt,
      model: { provider: 'deepseek', model: 'deepseek-chat' },
    };
    capabilities = tmpl.capabilities;
  } else if (customName) {
    config = {
      name: customName,
      description: customPrompt || `自定义Agent: ${customName}`,
      systemPrompt: customPrompt || `你是${customName}，一个专业的AI助手。`,
      model: { provider: 'deepseek', model: 'deepseek-chat' },
    };
    capabilities = customCapabilities || ['general'];
  } else {
    res.status(400).json({ error: 'Must provide template or customName' });
    return;
  }

  const executor = createDeepSeekExecutor(sessionId);
  const agent = new Agent(config, executor);
  session.agents.set(agent.id, agent);

  res.json({
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      capabilities,
      state: agent.getState(),
    },
  });
});

app.post('/api/sessions/:sessionId/agents/auto-generate', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { task } = req.body;
  if (!task) {
    res.status(400).json({ error: 'Task description required' });
    return;
  }

  try {
    const planningResponse = await deepseekClient.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `你是一个多Agent系统的任务规划师。根据用户任务，分析需要哪些Agent来协作完成。
请以JSON格式返回，格式如下：
{
  "agents": [
    {
      "name": "Agent名称",
      "role": "Agent角色描述",
      "systemPrompt": "Agent的系统提示词",
      "capabilities": ["能力1", "能力2"],
      "reason": "为什么需要这个Agent"
    }
  ],
  "collaborationMode": "sequential|parallel|expert_team",
  "executionPlan": "执行计划描述"
}

要求：
1. 根据任务复杂度生成2-5个Agent
2. 每个Agent有明确的职责分工
3. 选择最合适的协作模式
4. 只返回JSON，不要其他内容`,
        },
        { role: 'user', content: `任务：${task}` },
      ],
      temperature: 0.5,
      max_tokens: 2048,
    });

    const planText = planningResponse.choices[0]?.message?.content || '';
    const jsonMatch = planText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: 'Failed to parse agent plan' });
      return;
    }

    const plan = JSON.parse(jsonMatch[0]);
    const executor = createDeepSeekExecutor(sessionId);
    const createdAgents: any[] = [];

    for (const agentDef of plan.agents) {
      const config: AgentConfig = {
        name: agentDef.name,
        description: agentDef.role,
        systemPrompt: agentDef.systemPrompt,
        model: { provider: 'deepseek', model: 'deepseek-chat' },
      };

      const agent = new Agent(config, executor);
      session.agents.set(agent.id, agent);
      createdAgents.push({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        capabilities: agentDef.capabilities,
        reason: agentDef.reason,
        state: agent.getState(),
      });

      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(
          JSON.stringify({
            type: 'agent_created',
            agent: {
              id: agent.id,
              name: agent.name,
              description: agent.description,
              capabilities: agentDef.capabilities,
              reason: agentDef.reason,
              state: agent.getState(),
            },
          })
        );
      }
    }

    res.json({
      agents: createdAgents,
      collaborationMode: plan.collaborationMode,
      executionPlan: plan.executionPlan,
    });
  } catch (error: any) {
    console.error('Deep plan error:', error.message);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.post('/api/sessions/:sessionId/deep-plan', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { task, targetWordCount, maxAgents } = req.body;
  if (!task) {
    res.status(400).json({ error: 'Task description required' });
    return;
  }

  try {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'planning_started',
        task,
      }));
    }

    const planner = new DeepPlanner(DEEPSEEK_API_KEY);
    const plan = await planner.createDeepPlan(task, {
      targetWordCount: targetWordCount || 30000,
      maxAgents: maxAgents || 10,
      depth: 2,
    });

    session.currentPlan = plan;
    await sessionStore.patchSession(sessionId, {
      status: 'running',
      mode: 'deep',
      task,
      plan: toPersistedPlan(plan),
    });

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'planning_completed',
        plan: {
          id: plan.id,
          goal: plan.goal,
          subTaskCount: plan.subTasks.length,
          collaborationMode: plan.collaborationMode,
          communicationStructure: plan.communicationStructure,
          executionStrategy: plan.executionStrategy,
          subTasks: plan.subTasks.map((t) => ({
            id: t.id,
            title: t.title,
            assignedAgentName: t.assignedAgentName,
            assignedAgentType: t.assignedAgentType,
            dependencies: t.dependencies,
            priority: t.priority,
            tools: t.tools,
            expectedOutput: t.expectedOutput,
          })),
          successCriteria: plan.successCriteria,
          qualityThresholds: plan.qualityThresholds,
        },
      }));
    }

    res.json({
      plan: {
        id: plan.id,
        goal: plan.goal,
        subTaskCount: plan.subTasks.length,
        collaborationMode: plan.collaborationMode,
        communicationStructure: plan.communicationStructure,
        executionStrategy: plan.executionStrategy,
        subTasks: plan.subTasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          assignedAgentName: t.assignedAgentName,
          assignedAgentType: t.assignedAgentType,
          assignedAgentPrompt: t.assignedAgentPrompt,
          dependencies: t.dependencies,
          priority: t.priority,
          tools: t.tools,
          expectedOutput: t.expectedOutput,
        })),
        successCriteria: plan.successCriteria,
        qualityThresholds: plan.qualityThresholds,
      },
    });
  } catch (error: any) {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'planning_error',
        error: error.message,
      }));
    }
    await markPersistedSessionFailed(sessionId, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sessions/:sessionId/cluster-execute', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { task, targetWordCount, maxAgents, maxIterations } = req.body;
  if (!task) {
    res.status(400).json({ error: 'Task description required' });
    return;
  }

  try {
    await sessionStore.patchSession(sessionId, {
      status: 'running',
      mode: 'deep',
      task,
      error: undefined,
    });

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'cluster_execution_started',
        task,
      }));
    }

    const planner = new DeepPlanner(DEEPSEEK_API_KEY);
    const plan = await planner.createDeepPlan(task, {
      targetWordCount: targetWordCount || 30000,
      maxAgents: maxAgents || 10,
      depth: 2,
    });

    session.currentPlan = plan;
    await sessionStore.patchSession(sessionId, {
      status: 'running',
      mode: 'deep',
      task,
      plan: toPersistedPlan(plan),
    });

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'plan_created',
        plan: {
          id: plan.id,
          goal: plan.goal,
          subTaskCount: plan.subTasks.length,
          collaborationMode: plan.collaborationMode,
          subTasks: plan.subTasks.map((t) => ({
            id: t.id,
            title: t.title,
            assignedAgentName: t.assignedAgentName,
            assignedAgentType: t.assignedAgentType,
            dependencies: t.dependencies,
            priority: t.priority,
            tools: t.tools,
          })),
        },
      }));
    }

    const cluster = new AgentCluster(DEEPSEEK_API_KEY, sessionId);
    session.cluster = cluster;

    cluster.onEvent((event: ClusterEvent) => {
      void sessionStore.patchSession(sessionId, { status: 'running' }).catch(() => {});
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({
          type: 'cluster_event',
          eventType: event.type,
          taskId: event.taskId,
          agentName: event.agentName,
          data: event.data,
          timestamp: event.timestamp,
        }));
      }
    });

    const result = await cluster.executePlan(plan, maxIterations || 3);
    session.executionResult = result;
    await sessionStore.patchSession(sessionId, {
      status: result.success ? 'completed' : 'failed',
      mode: 'deep',
      task,
      plan: toPersistedPlan(plan),
      result: toPersistedClusterResult(result),
      error: result.success ? undefined : 'Cluster execution failed',
    });

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'cluster_execution_completed',
        result: {
          success: result.success,
          totalExecutionTime: result.totalExecutionTime,
          totalTokensUsed: result.totalTokensUsed,
          evaluationScore: result.evaluationScore,
          iterations: result.iterations,
          finalOutputLength: result.finalOutput.length,
        },
      }));
    }

    res.json({
      success: result.success,
      totalExecutionTime: result.totalExecutionTime,
      totalTokensUsed: result.totalTokensUsed,
      evaluationScore: result.evaluationScore,
      iterations: result.iterations,
      finalOutput: result.finalOutput,
      progress: result.progress,
    });
  } catch (error: any) {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'cluster_execution_error',
        error: error.message,
      }));
    }
    await markPersistedSessionFailed(sessionId, error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sessions/:sessionId/cluster-progress', async (req, res) => {
  await expireStaleRunningSessions();
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  const persisted = sessionStore.getSession(sessionId);
  if (!session) {
    if (persisted?.result?.progress) {
      res.json({ progress: persisted.result.progress });
      return;
    }
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const progress = session.cluster?.getProgress() || [];
  res.json({ progress });
});

app.get('/api/sessions/:sessionId/result', async (req, res) => {
  await expireStaleRunningSessions();
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  const persisted = sessionStore.getSession(sessionId);
  if (!session && !persisted) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const persistedResult = persisted?.result;
  res.json({
    result: session.executionResult ? {
      success: session.executionResult.success,
      finalOutput: session.executionResult.finalOutput,
      totalExecutionTime: session.executionResult.totalExecutionTime,
      totalTokensUsed: session.executionResult.totalTokensUsed,
      evaluationScore: session.executionResult.evaluationScore,
      iterations: session.executionResult.iterations,
      progress: session.executionResult.progress,
    } : persistedResult ? {
      success: persistedResult.success,
      finalOutput: persistedResult.finalOutput,
      totalExecutionTime: persistedResult.totalExecutionTime,
      totalTokensUsed: persistedResult.totalTokensUsed,
      evaluationScore: persistedResult.evaluationScore,
      iterations: persistedResult.iterations,
      progress: persistedResult.progress,
    } : null,
    session: persisted || null,
  });
});

app.post('/api/sessions/:sessionId/execute', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { task, mode, agentIds } = req.body;

  const agents: Agent[] = [];
  if (agentIds && agentIds.length > 0) {
    for (const id of agentIds) {
      const agent = session.agents.get(id);
      if (agent) agents.push(agent);
    }
  } else {
    session.agents.forEach((agent) => agents.push(agent));
  }

  if (agents.length === 0) {
    res.status(400).json({ error: 'No agents available' });
    return;
  }

  const context: AgentContext = {
    sessionId: sessionId as SessionId,
    taskId: uuidv4() as TaskId,
    depth: 0,
    iteration: 0,
    startTime: Date.now(),
    metadata: {},
  };

  try {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(
        JSON.stringify({
          type: 'execution_start',
          task,
          mode: mode || 'sequential',
          agentCount: agents.length,
        })
      );
    }

    let result: any;

    switch (mode) {
      case 'parallel': {
        const workflow = new ParallelProcessing(agents, context);
        result = await workflow.execute(task);
        break;
      }
      case 'expert_team': {
        const capabilities = agents.map(
          (_, i) => `capability_${i}`
        );
        const team = new ExpertTeam(agents, context, capabilities);
        result = await team.execute(task);
        break;
      }
      case 'orchestrator': {
        const orchestrator = new Orchestrator({
          maxConcurrentTasks: 3,
          enableAutoRecovery: true,
        });
        agents.forEach((agent) => orchestrator.registerAgent(agent));
        const results = await orchestrator.executeGoal(task);
        result = { success: results.every((r) => r.success), results, executionTime: Date.now() - context.startTime };
        break;
      }
      default: {
        const workflow = new SequentialHandoffs(agents, context);
        result = await workflow.execute(task);
      }
    }

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(
        JSON.stringify({
          type: 'execution_complete',
          success: result.success,
          executionTime: result.executionTime,
          resultCount: result.results?.length || 0,
        })
      );
    }

    res.json({
      success: result.success,
      executionTime: result.executionTime,
      results: result.results?.map((r: any) => ({
        success: r.success,
        data: r.data,
        executionTime: r.executionTime,
        agentId: r.agentId,
      })),
    });
  } catch (error: any) {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(
        JSON.stringify({
          type: 'execution_error',
          error: error.message,
        })
      );
    }
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sessions/:sessionId/agents', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const agents: any[] = [];
  session.agents.forEach((agent) => {
    agents.push({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      state: agent.getState(),
      stats: agent.getStats(),
    });
  });

  res.json({ agents });
});

app.get('/api/agent-templates', (_req, res) => {
  res.json({ templates: AGENT_TEMPLATES });
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://localhost`);
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    ws.close(4001, 'sessionId required');
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    ws.close(4002, 'Session not found');
    return;
  }

  session.ws = ws;

  ws.send(
    JSON.stringify({
      type: 'connected',
      sessionId,
      message: 'WebSocket connected',
    })
  );

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
    } catch {
      // ignore
    }
  });

  ws.on('close', () => {
    if (session.ws === ws) {
      session.ws = undefined;
    }
  });
});

const PORT = process.env.PORT || 3001;

app.post('/api/sessions/:sessionId/collaborate', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { mode, task, agents: agentSpecs } = req.body;
  if (!mode || !task) {
    res.status(400).json({ error: 'mode and task are required' });
    return;
  }

  try {
    await sessionStore.patchSession(sessionId, {
      status: 'running',
      mode,
      task,
      error: undefined,
    });

    const collaboration = new LLMAgentCollaboration(DEEPSEEK_API_KEY);
    const agents = (agentSpecs || []).map((a: any, i: number) => ({
      id: a.id || `agent_${i}`,
      name: a.name || `Agent ${i + 1}`,
      type: a.type || 'general',
      systemPrompt: a.systemPrompt || a.prompt || `你是一个专业的AI助手。`,
      tools: a.tools || [],
      specialty: a.specialty,
    }));

    let result;

    switch (mode) {
      case 'sequential':
        result = await collaboration.executeSequential(agents, task);
        break;
      case 'parallel':
        result = await collaboration.executeParallel(agents, task);
        break;
      case 'debate':
        result = await collaboration.executeDebate(agents, task, 3);
        break;
      case 'hierarchical':
        if (agents.length < 2) {
          res.status(400).json({ error: 'Hierarchical mode requires at least 2 agents (1 supervisor + 1 subordinate)' });
          return;
        }
        result = await collaboration.executeHierarchical(agents[0]!, agents.slice(1), task);
        break;
      case 'expert_team':
        result = await collaboration.executeExpertTeam(
          agents.map((a: any) => ({ ...a, specialty: a.specialty || a.type || 'general' })),
          task
        );
        break;
      case 'critic_reviewer':
        if (agents.length < 2) {
          res.status(400).json({ error: 'Critic-Reviewer mode requires at least 2 agents (1 creator + 1 critic)' });
          return;
        }
        result = await collaboration.executeCriticReviewer(agents[0]!, agents[1]!, task, 2);
        break;
      default:
        res.status(400).json({ error: `Unknown mode: ${mode}. Available: sequential, parallel, debate, hierarchical, expert_team, critic_reviewer` });
        return;
    }

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'collaboration_completed',
        mode,
        result: {
          success: result.success,
          totalTokens: result.totalTokens,
          totalExecutionTime: result.totalExecutionTime,
          iterations: result.iterations,
          finalOutputLength: result.finalOutput.length,
        },
      }));
    }

    await sessionStore.patchSession(sessionId, {
      status: result.success ? 'completed' : 'failed',
      mode,
      task,
      result: {
        success: result.success,
        finalOutput: result.finalOutput || '',
        totalExecutionTime: result.totalExecutionTime || 0,
        totalTokensUsed: result.totalTokens || 0,
        evaluationScore: 0,
        iterations: result.iterations || 1,
        progress: [],
      },
      error: result.success ? undefined : 'Collaboration failed',
    });

    res.json(result);
  } catch (error: any) {
    console.error(`Collaboration error (${mode}):`, error.message);
    await markPersistedSessionFailed(sessionId, error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.post('/api/sessions/:sessionId/workflow-execute', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { task, tokenBudget, maxConcurrentAgents, args } = req.body;
  if (!task) {
    res.status(400).json({ error: 'task is required' });
    return;
  }

  try {
    await sessionStore.patchSession(sessionId, {
      status: 'running',
      mode: 'workflow',
      task,
      error: undefined,
    });

    const workflow = new DynamicWorkflow({
      apiKey: DEEPSEEK_API_KEY,
      tokenBudget: tokenBudget || 200000,
      maxConcurrentAgents: maxConcurrentAgents || 5,
    });
    session.workflow = workflow;

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'workflow_started',
        task,
      }));
    }

    workflow.onEvent((event: WorkflowEvent) => {
      void sessionStore.patchSession(sessionId, { status: 'running' }).catch(() => {});
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({
          type: 'workflow_event',
          eventType: event.type,
          data: event,
          timestamp: event.timestamp,
        }));
      }
    });

    const result = await workflow.run(task, args);
    session.workflowResult = result;
    await sessionStore.patchSession(sessionId, {
      status: result.success ? 'completed' : 'failed',
      mode: 'workflow',
      task,
      workflowResult: toPersistedWorkflowResult(result),
      error: result.success ? undefined : 'Workflow failed',
    });

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'workflow_completed',
        result: {
          success: result.success,
          totalTokens: result.totalTokens,
          totalExecutionTime: result.totalExecutionTime,
          snapshot: result.snapshot,
        },
      }));
    }

    res.json({
      success: result.success,
      output: result.output,
      totalTokens: result.totalTokens,
      totalExecutionTime: result.totalExecutionTime,
      snapshot: result.snapshot,
    });
  } catch (error: any) {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'workflow_error',
        error: error.message,
      }));
    }
    await markPersistedSessionFailed(sessionId, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sessions/:sessionId/workflow-run-script', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { script, args } = req.body;
  if (!script) {
    res.status(400).json({ error: 'script is required' });
    return;
  }

  try {
    const workflow = session.workflow || new DynamicWorkflow({
      apiKey: DEEPSEEK_API_KEY,
      tokenBudget: 200000,
      maxConcurrentAgents: 5,
    });
    session.workflow = workflow;

    const validation = await workflow.validateScript(script);
    if (!validation.valid) {
      res.status(400).json({ error: `Invalid script: ${validation.error}` });
      return;
    }
    const workflowTask = validation.meta?.name || 'custom_script';

    await sessionStore.patchSession(sessionId, {
      status: 'running',
      mode: 'workflow',
      task: workflowTask,
      error: undefined,
    });

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'workflow_started',
        task: workflowTask,
      }));
    }

    workflow.onEvent((event: WorkflowEvent) => {
      void sessionStore.patchSession(sessionId, { status: 'running' }).catch(() => {});
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({
          type: 'workflow_event',
          eventType: event.type,
          data: event,
          timestamp: event.timestamp,
        }));
      }
    });

    const result = await workflow.executeScript(script, args);
    session.workflowResult = result;
    await sessionStore.patchSession(sessionId, {
      status: result.success ? 'completed' : 'failed',
      mode: 'workflow',
      task: workflowTask,
      workflowResult: toPersistedWorkflowResult(result),
      error: result.success ? undefined : 'Workflow failed',
    });

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'workflow_completed',
        result: {
          success: result.success,
          totalTokens: result.totalTokens,
          totalExecutionTime: result.totalExecutionTime,
          snapshot: result.snapshot,
        },
      }));
    }

    res.json({
      success: result.success,
      output: result.output,
      totalTokens: result.totalTokens,
      totalExecutionTime: result.totalExecutionTime,
      snapshot: result.snapshot,
      meta: validation.meta,
    });
  } catch (error: any) {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'workflow_error',
        error: error.message,
      }));
    }
    await markPersistedSessionFailed(sessionId, error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sessions/:sessionId/workflow-result', async (req, res) => {
  await expireStaleRunningSessions();
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  const persisted = sessionStore.getSession(sessionId);
  if (!session && !persisted) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  if (!session?.workflowResult && !persisted?.workflowResult) {
    res.json({ hasResult: false });
    return;
  }

  const result = session?.workflowResult || persisted?.workflowResult;
  res.json({
    hasResult: true,
    success: result?.success,
    output: result?.output,
    totalTokens: result?.totalTokens,
    totalExecutionTime: result?.totalExecutionTime,
    snapshot: result?.snapshot,
    session: persisted || null,
  });
});

async function startServer(): Promise<void> {
  await sessionStore.load();
  await Promise.all(
    sessionStore
      .listSessions()
      .filter((session) => session.status === 'running')
      .map((session) =>
        sessionStore.patchSession(session.id, {
          status: 'failed',
          error: 'Server restarted before execution completed',
        })
      )
  );
  server.listen(PORT, () => {
  console.log(`\n🚀 Pi Multi-Agent Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`\nAPI Endpoints:`);
  console.log(`  GET    /api/sessions                        - List persisted sessions`);
  console.log(`  POST   /api/sessions                        - Create session`);
  console.log(`  GET    /api/sessions/:id                    - Get persisted session`);
  console.log(`  POST   /api/sessions/:id/agents              - Create agent`);
  console.log(`  POST   /api/sessions/:id/agents/auto-generate - Auto-generate agents`);
  console.log(`  POST   /api/sessions/:id/deep-plan           - Deep plan with LLM`);
  console.log(`  POST   /api/sessions/:id/cluster-execute     - Cluster execute (deep)`);
  console.log(`  GET    /api/sessions/:id/cluster-progress     - Get cluster progress`);
  console.log(`  GET    /api/sessions/:id/result              - Get execution result`);
  console.log(`  POST   /api/sessions/:id/execute             - Execute task (simple)`);
  console.log(`  GET    /api/sessions/:id/agents              - List agents`);
  console.log(`  GET    /api/agent-templates                  - List templates`);
  console.log(`  POST   /api/sessions/:id/workflow-execute     - Dynamic workflow (auto-generate script)`);
  console.log(`  POST   /api/sessions/:id/workflow-run-script  - Dynamic workflow (custom script)`);
  console.log(`  GET    /api/sessions/:id/workflow-result      - Get workflow result`);
  console.log(``);
  });
}

startServer().catch((error) => {
  console.error('Failed to start Pi Multi-Agent Server:', error);
  process.exit(1);
});
