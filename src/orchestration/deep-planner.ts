import OpenAI from 'openai';
import { LLM_DEFAULTS } from '../core/llm-config';

export interface SubTask {
  id: string;
  title: string;
  description: string;
  assignedAgentType: string;
  assignedAgentName: string;
  assignedAgentPrompt: string;
  dependencies: string[];
  expectedOutput: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  depth: number;
  tools: string[];
}

export interface DeepPlan {
  id: string;
  goal: string;
  subTasks: SubTask[];
  collaborationMode: 'sequential' | 'parallel' | 'expert_team' | 'hierarchical' | 'debate' | 'critic_review';
  communicationStructure: 'supervisor' | 'network' | 'hierarchical' | 'supervisor_as_tool';
  executionStrategy: string;
  estimatedDuration: string;
  successCriteria: string[];
  qualityThresholds: {
    minWordCount: number;
    minSections: number;
    requireDataSupport: boolean;
    requireReferences: boolean;
  };
}

let planIdCounter = 0;

export class DeepPlanner {
  private llmClient: OpenAI;

  private model: string;

  constructor(apiKey: string, baseURL: string = LLM_DEFAULTS.baseURL, model: string = LLM_DEFAULTS.model) {
    this.llmClient = new OpenAI({ apiKey, baseURL });
    this.model = model;
  }

  async createDeepPlan(goal: string, options?: {
    targetWordCount?: number;
    maxAgents?: number;
    depth?: number;
  }): Promise<DeepPlan> {
    const targetWordCount = options?.targetWordCount ?? 30000;
    const maxAgents = options?.maxAgents ?? 10;
    const depth = options?.depth ?? 2;

    const planningPrompt = this.buildPlanningPrompt(goal, targetWordCount, maxAgents, depth);

    const response = await this.llmClient.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `你是一个顶级Multi-Agent系统的任务规划大师。你的职责是将复杂任务深度拆解为可执行的子任务网络。

核心原则：
1. 每个子任务必须足够具体，让Agent能独立完成
2. 子任务之间有明确的依赖关系和数据流
3. 每个Agent必须有专属工具集
4. 输出要求必须量化（字数、章节数、数据点数等）
5. 质量标准必须可衡量

你必须返回严格的JSON格式，不要有任何其他文字。`,
        },
        { role: 'user', content: planningPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
    });

    const planText = this.getMessageText(response);
    const jsonMatch = planText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Failed to parse deep plan: ${planText.substring(0, 200)}`);
    }

    const rawPlan = JSON.parse(jsonMatch[0]);
    return this.normalizePlan(rawPlan, goal);
  }

  private getMessageText(response: any): string {
    const message = response?.choices?.[0]?.message;
    const content = message?.content;
    if (typeof content === 'string' && content.trim().length > 0) {
      return content;
    }
    const reasoning = (message as any)?.reasoning;
    if (typeof reasoning === 'string' && reasoning.trim().length > 0) {
      return reasoning;
    }
    return '';
  }

  private buildPlanningPrompt(goal: string, targetWordCount: number, maxAgents: number, depth: number): string {
    return `请为以下任务制定深度执行计划：

## 任务目标
${goal}

## 规划要求
1. 目标输出字数：${targetWordCount}字以上
2. 最多${maxAgents}个Agent
3. 任务拆解深度：${depth}层
4. 每个Agent必须配备专业工具

## 输出JSON格式
{
  "collaborationMode": "sequential|parallel|expert_team|hierarchical|debate|critic_review",
  "communicationStructure": "supervisor|network|hierarchical|supervisor_as_tool",
  "executionStrategy": "详细的执行策略描述",
  "estimatedDuration": "预估完成时间",
  "successCriteria": ["成功标准1", "成功标准2", ...],
  "qualityThresholds": {
    "minWordCount": ${targetWordCount},
    "minSections": 8,
    "requireDataSupport": true,
    "requireReferences": true
  },
  "subTasks": [
    {
      "id": "task_1",
      "title": "子任务标题",
      "description": "详细的任务描述，包括具体要调研/分析/撰写的内容",
      "assignedAgentType": "researcher|analyst|writer|critic|coder|strategist",
      "assignedAgentName": "Agent的专业名称",
      "assignedAgentPrompt": "Agent的详细系统提示词，包含专业背景、输出要求、格式规范",
      "dependencies": ["依赖的前置任务ID"],
      "expectedOutput": "期望输出的详细描述，包括字数要求、格式要求",
      "priority": "critical|high|normal|low",
      "depth": 0,
      "tools": ["web_search", "data_analyzer", ...]
    }
  ]
}

## 规划指导
- 调研类任务：必须使用web_search工具，要求搜索至少5个不同来源
- 分析类任务：必须使用data_analyzer工具，要求有数据支撑
- 撰写类任务：必须指定字数要求（每个章节至少2000字）
- 审核类任务：必须列出审核维度和通过标准
- 战略类任务：必须包含SWOT分析和量化指标

请确保：
1. 子任务覆盖目标的所有维度
2. 每个子任务的输出要求明确量化
3. Agent之间的信息传递路径清晰
4. 有质量审核环节
5. 最终有综合汇总环节`;
  }

  private normalizePlan(rawPlan: any, goal: string): DeepPlan {
    const subTasks: SubTask[] = (rawPlan.subTasks || []).map((task: any, index: number) => ({
      id: task.id || `task_${index + 1}`,
      title: task.title || `子任务 ${index + 1}`,
      description: task.description || '',
      assignedAgentType: task.assignedAgentType || 'general',
      assignedAgentName: task.assignedAgentName || `Agent-${index + 1}`,
      assignedAgentPrompt: task.assignedAgentPrompt || `你是一个专业的AI助手。`,
      dependencies: task.dependencies || [],
      expectedOutput: task.expectedOutput || '',
      priority: task.priority || 'normal',
      depth: task.depth ?? 0,
      tools: task.tools || ['web_search'],
    }));

    return {
      id: `plan_${Date.now()}_${++planIdCounter}`,
      goal,
      subTasks,
      collaborationMode: rawPlan.collaborationMode || 'sequential',
      communicationStructure: rawPlan.communicationStructure || 'supervisor',
      executionStrategy: rawPlan.executionStrategy || '',
      estimatedDuration: rawPlan.estimatedDuration || '',
      successCriteria: rawPlan.successCriteria || [],
      qualityThresholds: rawPlan.qualityThresholds || {
        minWordCount: 30000,
        minSections: 8,
        requireDataSupport: true,
        requireReferences: true,
      },
    };
  }

  async replan(
    originalPlan: DeepPlan,
    evaluationResult: {
      score: number;
      failedDimensions: string[];
      feedback: string;
    }
  ): Promise<DeepPlan> {
    const failedTasks = originalPlan.subTasks.filter(
      (t) => t.priority === 'critical' || t.priority === 'high'
    );

    const replanPrompt = `原始任务目标: ${originalPlan.goal}

评估结果:
- 总分: ${evaluationResult.score}
- 未达标维度: ${evaluationResult.failedDimensions.join(', ')}
- 反馈: ${evaluationResult.feedback}

需要改进的任务:
${failedTasks.map((t) => `- ${t.title}: ${t.description}`).join('\n')}

请重新规划这些任务，提高输出质量。返回与之前相同格式的JSON。`;

    const response = await this.llmClient.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: '你是任务重新规划专家。根据评估反馈调整任务计划，提高输出质量。只返回JSON。',
        },
        { role: 'user', content: replanPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
    });

    const planText = this.getMessageText(response);
    const jsonMatch = planText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return originalPlan;
    }

    try {
      const rawPlan = JSON.parse(jsonMatch[0]);
      return this.normalizePlan(rawPlan, originalPlan.goal);
    } catch {
      return originalPlan;
    }
  }

  getDependencyGraph(plan: DeepPlan): { nodes: Array<{ id: string; label: string; type: string; priority: string }>; edges: Array<{ from: string; to: string }> } {
    const nodes = plan.subTasks.map((t) => ({
      id: t.id,
      label: t.title,
      type: t.assignedAgentType,
      priority: t.priority,
    }));

    const edges: Array<{ from: string; to: string }> = [];
    for (const task of plan.subTasks) {
      for (const dep of task.dependencies) {
        edges.push({ from: dep, to: task.id });
      }
    }

    return { nodes, edges };
  }

  getExecutionOrder(plan: DeepPlan): string[][] {
    const taskMap = new Map(plan.subTasks.map((t) => [t.id, t]));
    const completed = new Set<string>();
    const order: string[][] = [];
    const remaining = new Set(plan.subTasks.map((t) => t.id));

    while (remaining.size > 0) {
      const ready: string[] = [];
      for (const taskId of remaining) {
        const task = taskMap.get(taskId);
        if (task && task.dependencies.every((d) => completed.has(d))) {
          ready.push(taskId);
        }
      }

      if (ready.length === 0) {
        const remainingArr = Array.from(remaining);
        order.push(remainingArr);
        break;
      }

      order.push(ready);
      for (const id of ready) {
        completed.add(id);
        remaining.delete(id);
      }
    }

    return order;
  }

  getPlanSummary(plan: DeepPlan): {
    totalTasks: number;
    criticalTasks: number;
    maxParallelism: number;
    estimatedRounds: number;
    agentTypes: Record<string, number>;
    toolUsage: Record<string, number>;
  } {
    const executionOrder = this.getExecutionOrder(plan);
    const agentTypes: Record<string, number> = {};
    const toolUsage: Record<string, number> = {};

    for (const task of plan.subTasks) {
      agentTypes[task.assignedAgentType] = (agentTypes[task.assignedAgentType] || 0) + 1;
      for (const tool of task.tools) {
        toolUsage[tool] = (toolUsage[tool] || 0) + 1;
      }
    }

    return {
      totalTasks: plan.subTasks.length,
      criticalTasks: plan.subTasks.filter((t) => t.priority === 'critical').length,
      maxParallelism: Math.max(...executionOrder.map((r) => r.length)),
      estimatedRounds: executionOrder.length,
      agentTypes,
      toolUsage,
    };
  }
}
