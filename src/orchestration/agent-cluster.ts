import OpenAI from 'openai';
import { SessionId, TaskId, ToolDefinition, ToolExecutionContext } from '../core/index.js';
import { DeepPlan, SubTask } from '../orchestration/deep-planner.js';
import { DeepEvaluator, DeepEvaluationResult } from '../orchestration/deep-evaluator.js';
import { getToolsForAgentType, ALL_TOOLS, createAgentAsTool } from '../tools/index.js';
import { EnhancedSharedMemory } from '../memory/enhanced-shared-memory.js';

export interface AgentClusterProgress {
  taskId: string;
  taskTitle: string;
  agentName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying';
  progress: number;
  startTime?: number;
  endTime?: number;
  outputLength?: number;
  toolCalls?: ToolCallRecord[];
  error?: string;
}

export interface ToolCallRecord {
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  duration: number;
  success: boolean;
}

export interface ClusterExecutionResult {
  success: boolean;
  plan: DeepPlan;
  progress: AgentClusterProgress[];
  finalOutput: string;
  totalExecutionTime: number;
  totalTokensUsed: number;
  evaluationScore: number;
  iterations: number;
}

export interface ClusterEvent {
  type: 'task_started' | 'task_completed' | 'task_failed' | 'agent_thinking' | 'agent_response' | 'tool_call' | 'tool_result' | 'evaluation' | 'iteration_complete' | 'agent_created' | 'plan_updated';
  taskId?: string;
  agentName?: string;
  data: unknown;
  timestamp: number;
}

type EventCallback = (event: ClusterEvent) => void;

function convertToolsToOpenAIFormat(tools: ToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((tool) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    if (tool.inputSchema && typeof tool.inputSchema === 'object') {
      const schema = tool.inputSchema as { properties?: Record<string, { type?: string; description?: string; enum?: string[] }>; required?: string[] };
      if (schema.properties) {
        for (const [key, val] of Object.entries(schema.properties)) {
          properties[key] = {
            type: val.type || 'string',
            description: val.description || '',
            ...(val.enum ? { enum: val.enum } : {}),
          };
        }
      }
      if (schema.required) {
        required.push(...schema.required);
      }
    }

    return {
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object' as const,
          properties,
          required,
        },
      },
    } as OpenAI.Chat.ChatCompletionTool;
  });
}

export class AgentCluster {
  private llmClient: OpenAI;
  private sessionId: string;
  private progress: Map<string, AgentClusterProgress> = new Map();
  private results: Map<string, string> = new Map();
  private eventCallbacks: EventCallback[] = [];
  private totalTokens = 0;
  private currentPlan: DeepPlan | null = null;
  private toolInstances: Map<string, ToolDefinition<unknown, unknown>> = new Map();

  private apiKey: string;
  private baseURL: string;
  private deepEvaluator: DeepEvaluator;
  private lastEvaluation: DeepEvaluationResult | null = null;
  public sharedMemory: EnhancedSharedMemory;

  constructor(apiKey: string, sessionId: string, baseURL: string = 'https://api.deepseek.com') {
    this.llmClient = new OpenAI({ apiKey, baseURL });
    this.sessionId = sessionId;
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.deepEvaluator = new DeepEvaluator(apiKey, baseURL);
    this.sharedMemory = new EnhancedSharedMemory(sessionId as SessionId);
    this.initializeToolInstances();
  }

  private initializeToolInstances(): void {
    for (const [name, factory] of Object.entries(ALL_TOOLS)) {
      if (typeof factory === 'function') {
        try {
          this.toolInstances.set(name, factory() as ToolDefinition<unknown, unknown>);
        } catch {}
      }
    }
    this.toolInstances.set('agent_delegate', createAgentAsTool(this.apiKey, this.baseURL) as ToolDefinition<unknown, unknown>);
  }

  onEvent(callback: EventCallback): void {
    this.eventCallbacks.push(callback);
  }

  private emitEvent(type: ClusterEvent['type'], data: unknown, taskId?: string, agentName?: string): void {
    const event: ClusterEvent = { type, taskId, agentName, data, timestamp: Date.now() };
    for (const cb of this.eventCallbacks) {
      try { cb(event); } catch {}
    }
  }

  async executePlan(plan: DeepPlan, maxIterations: number = 3): Promise<ClusterExecutionResult> {
    const startTime = Date.now();
    let iteration = 0;
    let currentPlan = plan;
    this.currentPlan = plan;
    let evaluationScore = 0;

    this.sharedMemory.setGoal(plan.goal);
    this.sharedMemory.setPhase('executing');

    this.emitEvent('plan_updated', {
      planId: plan.id,
      goal: plan.goal,
      subTaskCount: plan.subTasks.length,
      collaborationMode: plan.collaborationMode,
    });

    for (const task of plan.subTasks) {
      this.progress.set(task.id, {
        taskId: task.id,
        taskTitle: task.title,
        agentName: task.assignedAgentName,
        status: 'pending',
        progress: 0,
        toolCalls: [],
      });
      this.emitEvent('agent_created', {
        agentName: task.assignedAgentName,
        agentType: task.assignedAgentType,
        tools: task.tools,
        taskTitle: task.title,
      }, task.id, task.assignedAgentName);

      this.sharedMemory.registerAgent(
        task.assignedAgentName as any,
        task.assignedAgentName,
        task.assignedAgentType
      );
      this.sharedMemory.addPendingTask(task.id as TaskId);
    }

    while (iteration < maxIterations) {
      this.emitEvent('iteration_complete', { iteration, totalTasks: currentPlan.subTasks.length });

      const iterationResults = await this.executeIteration(currentPlan);

      evaluationScore = this.evaluateIterationResults(iterationResults, currentPlan);

      this.emitEvent('evaluation', { score: evaluationScore, iteration });

      if (evaluationScore >= 0.8) {
        break;
      }

      iteration++;
      currentPlan = await this.replanForIteration(currentPlan, evaluationScore, iterationResults);
      this.currentPlan = currentPlan;
    }

    const finalOutput = await this.synthesizeResults(currentPlan);

    this.lastEvaluation = await this.deepEvaluator.evaluate(finalOutput, plan.goal, {
      targetWordCount: plan.qualityThresholds?.minWordCount || 30000,
      minSections: plan.qualityThresholds?.minSections || 5,
      requireDataSupport: plan.qualityThresholds?.requireDataSupport ?? true,
      requireReferences: plan.qualityThresholds?.requireReferences ?? true,
      passThreshold: 0.7,
    });

    const deepEvalScore = this.lastEvaluation.overallScore;
    if (deepEvalScore > evaluationScore) {
      evaluationScore = deepEvalScore;
    }

    this.emitEvent('evaluation', {
      score: evaluationScore,
      deepScore: deepEvalScore,
      dimensions: this.lastEvaluation.dimensions.map((d) => ({
        name: d.name,
        score: d.score,
        passed: d.passed,
        feedback: d.feedback,
      })),
      strengths: this.lastEvaluation.strengths,
      weaknesses: this.lastEvaluation.weaknesses,
      suggestions: this.lastEvaluation.suggestions,
    });

    return {
      success: evaluationScore >= 0.6,
      plan: currentPlan,
      progress: Array.from(this.progress.values()),
      finalOutput,
      totalExecutionTime: Date.now() - startTime,
      totalTokensUsed: this.totalTokens,
      evaluationScore,
      iterations: iteration + 1,
    };
  }

  private async executeIteration(plan: DeepPlan): Promise<Map<string, string>> {
    const iterationResults = new Map<string, string>();
    const completedTasks = new Set<string>();

    const maxRounds = plan.subTasks.length + 2;
    let round = 0;

    while (completedTasks.size < plan.subTasks.length && round < maxRounds) {
      const readyTasks = plan.subTasks.filter((task) => {
        if (completedTasks.has(task.id)) return false;
        if (task.dependencies.length === 0) return true;
        return task.dependencies.every((dep) => completedTasks.has(dep));
      });

      if (readyTasks.length === 0) {
        const pendingTasks = plan.subTasks.filter((t) => !completedTasks.has(t.id));
        if (pendingTasks.length > 0) {
          for (const task of pendingTasks) {
            completedTasks.add(task.id);
          }
        }
        break;
      }

      const parallelLimit = 5;
      const tasksToExecute = readyTasks.slice(0, parallelLimit);

      const promises = tasksToExecute.map((task) =>
        this.executeSubTaskWithTools(task, iterationResults)
      );

      const results = await Promise.allSettled(promises);

      for (let i = 0; i < results.length; i++) {
        const settledResult = results[i] as PromiseSettledResult<string> | undefined;
        const task = tasksToExecute[i];
        if (!task || !settledResult) continue;

        if (settledResult.status === 'fulfilled' && settledResult.value) {
          iterationResults.set(task.id, settledResult.value);
          completedTasks.add(task.id);
        } else if (settledResult.status === 'rejected') {
          const error = String(settledResult.reason);
          this.updateProgress(task.id, 'failed', 0, undefined, error);
          iterationResults.set(task.id, `[任务失败: ${error}]`);
          completedTasks.add(task.id);
        } else {
          this.updateProgress(task.id, 'failed', 0, undefined, 'Empty result');
          iterationResults.set(task.id, '[任务失败: Empty result]');
          completedTasks.add(task.id);
        }
      }

      round++;
    }

    this.results = iterationResults;
    return iterationResults;
  }

  private async executeSubTaskWithTools(task: SubTask, previousResults: Map<string, string>): Promise<string> {
    this.updateProgress(task.id, 'running', 10);
    this.emitEvent('task_started', { task: task.title, agentType: task.assignedAgentType, tools: task.tools }, task.id, task.assignedAgentName);

    const agentTools = this.getToolDefinitions(task);
    const contextInput = this.buildTaskInput(task, previousResults);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: task.assignedAgentPrompt },
    ];

    if (agentTools.length > 0) {
      messages.push({
        role: 'system',
        content: `你拥有以下工具可以使用:\n${agentTools.map((t) => `- ${t.name}: ${t.description}`).join('\n')}\n\n请根据任务需要主动调用工具获取真实数据和信息。调用工具后，基于工具返回的真实结果进行分析和撰写。`,
      });
    }

    messages.push({ role: 'user', content: contextInput });

    const openaiTools = agentTools.length > 0 ? convertToolsToOpenAIFormat(agentTools) : undefined;
    const toolCallRecords: ToolCallRecord[] = [];
    let finalText = '';
    let maxToolRounds = 5;
    let currentMessages = [...messages];

    try {
      while (maxToolRounds > 0) {
        this.emitEvent('agent_thinking', { round: 6 - maxToolRounds, messageCount: currentMessages.length }, task.id, task.assignedAgentName);

        const response = await this.llmClient.chat.completions.create({
          model: 'deepseek-chat',
          messages: currentMessages,
          tools: openaiTools,
          temperature: 0.7,
          max_tokens: 4096,
        });

        if (response.usage) {
          this.totalTokens += response.usage.total_tokens;
        }

        const choice = response.choices[0];
        if (!choice) break;

        const assistantMessage = choice.message;
        currentMessages.push(assistantMessage);

        if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
          finalText = assistantMessage.content || '';
          break;
        }

        for (const toolCall of assistantMessage.tool_calls) {
          if (toolCall.type !== 'function') continue;
          const funcCall = toolCall as { id: string; type: 'function'; function: { name: string; arguments: string } };
          const toolName = funcCall.function.name;
          const toolInput = JSON.parse(funcCall.function.arguments || '{}');

          this.emitEvent('tool_call', { toolName, input: toolInput }, task.id, task.assignedAgentName);

          const toolStartTime = Date.now();
          let toolOutput = '';
          let toolSuccess = false;

          try {
            const toolDef = this.toolInstances.get(toolName);
            if (toolDef && toolDef.execute) {
              const toolContext: ToolExecutionContext = {
                sessionId: this.sessionId as SessionId,
                taskId: task.id as TaskId,
                agentId: task.assignedAgentName,
                metadata: {},
              };
              const result = await toolDef.execute(toolInput, toolContext);
              toolOutput = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
              toolSuccess = true;
            } else {
              toolOutput = `工具 ${toolName} 未找到，请基于已有知识完成任务。`;
            }
          } catch (err) {
            toolOutput = `工具调用错误: ${err instanceof Error ? err.message : String(err)}`;
          }

          const toolDuration = Date.now() - toolStartTime;
          toolCallRecords.push({
            toolName,
            input: toolInput,
            output: toolOutput.substring(0, 2000),
            duration: toolDuration,
            success: toolSuccess,
          });

          this.emitEvent('tool_result', { toolName, success: toolSuccess, duration: toolDuration, outputLength: toolOutput.length }, task.id, task.assignedAgentName);

          currentMessages.push({
            role: 'tool',
            tool_call_id: funcCall.id,
            content: toolOutput.substring(0, 4000),
          });
        }

        maxToolRounds--;
        this.updateProgress(task.id, 'running', Math.min(90, 10 + (6 - maxToolRounds) * 18), undefined, undefined, toolCallRecords);
      }

      if (!finalText) {
        const finalResponse = await this.llmClient.chat.completions.create({
          model: 'deepseek-chat',
          messages: [
            ...currentMessages,
            { role: 'user', content: '请基于以上所有工具调用结果和已有信息，完成你的任务。输出完整的、结构化的、专业的分析报告。' },
          ],
          temperature: 0.5,
          max_tokens: 4096,
        });

        if (finalResponse.usage) {
          this.totalTokens += finalResponse.usage.total_tokens;
        }

        finalText = finalResponse.choices[0]?.message?.content || '';
      }

      this.updateProgress(task.id, 'completed', 100, finalText.length, undefined, toolCallRecords);
      this.emitEvent('task_completed', { outputLength: finalText.length, toolCallCount: toolCallRecords.length }, task.id, task.assignedAgentName);

      this.sharedMemory.storeAgentOutput(task.id as TaskId, {
        agentId: task.assignedAgentName as any,
        agentName: task.assignedAgentName,
        taskId: task.id as TaskId,
        output: finalText,
        timestamp: Date.now(),
        tags: [task.assignedAgentType, task.priority],
        metadata: { toolCallCount: toolCallRecords.length },
      });
      this.sharedMemory.updateAgentStatus(task.assignedAgentName as any, 'completed');

      return finalText;
    } catch (error) {
      this.emitEvent('task_failed', { error: String(error) }, task.id, task.assignedAgentName);
      throw error;
    }
  }

  private getToolDefinitions(task: SubTask): ToolDefinition<unknown, unknown>[] {
    const tools: ToolDefinition<unknown, unknown>[] = [];
    for (const toolName of task.tools) {
      const toolDef = this.toolInstances.get(toolName);
      if (toolDef) {
        tools.push(toolDef);
      }
    }
    if (tools.length === 0) {
      return getToolsForAgentType(task.assignedAgentType) as ToolDefinition<unknown, unknown>[];
    }
    return tools;
  }

  private buildTaskInput(task: SubTask, previousResults: Map<string, string>): string {
    let input = `## 任务: ${task.title}\n\n`;
    input += `## 任务描述\n${task.description}\n\n`;
    input += `## 期望输出\n${task.expectedOutput}\n\n`;

    if (task.dependencies.length > 0 && previousResults.size > 0) {
      input += `## 前置任务结果\n\n`;
      for (const depId of task.dependencies) {
        const depResult = previousResults.get(depId);
        if (depResult) {
          const depTask = this.findTaskById(depId);
          input += `### ${depTask?.title || depId}\n${depResult.substring(0, 3000)}\n\n`;
        }
      }
    }

    const sharedContext = this.sharedMemory.buildContextForAgent(task.assignedAgentName as any, task.id as TaskId);
    if (sharedContext.length > 100) {
      input += `## 共享上下文\n${sharedContext}\n\n`;
    }

    input += `\n请完成以上任务。如果需要搜索信息、分析数据或获取资料，请主动调用可用工具。确保输出详细、专业、有数据支撑，字数不少于2000字。`;

    return input;
  }

  private findTaskById(taskId: string): SubTask | undefined {
    if (!this.currentPlan) return undefined;
    return this.currentPlan.subTasks.find((t) => t.id === taskId);
  }

  private updateProgress(
    taskId: string,
    status: AgentClusterProgress['status'],
    progress: number,
    outputLength?: number,
    error?: string,
    toolCalls?: ToolCallRecord[]
  ): void {
    const existing = this.progress.get(taskId);
    const existingToolCalls = existing?.toolCalls || [];
    this.progress.set(taskId, {
      taskId,
      taskTitle: existing?.taskTitle || taskId,
      agentName: existing?.agentName || '',
      status,
      progress,
      startTime: existing?.startTime || (status === 'running' ? Date.now() : undefined),
      endTime: status === 'completed' || status === 'failed' ? Date.now() : undefined,
      outputLength: outputLength ?? existing?.outputLength,
      toolCalls: toolCalls || existingToolCalls,
      error,
    });
  }

  private evaluateIterationResults(results: Map<string, string>, plan: DeepPlan): number {
    let totalScore = 0;
    let taskCount = 0;

    for (const task of plan.subTasks) {
      const result = results.get(task.id);
      if (!result) continue;

      taskCount++;
      let taskScore = 0;

      const wordCount = result.length;
      if (wordCount >= 2000) taskScore += 0.25;
      else if (wordCount >= 1000) taskScore += 0.15;
      else if (wordCount >= 500) taskScore += 0.08;

      const hasData = /\d+%|\d+亿|\d+万|\$|¥|USD|CNY|增长率|市场份额|规模/.test(result);
      if (hasData) taskScore += 0.2;

      const hasStructure = /#{1,3}\s|一、|二、|1\.|2\.|首先|其次|最后/.test(result);
      if (hasStructure) taskScore += 0.15;

      const hasReferences = /来源|引用|参考|根据|报告|研究/.test(result);
      if (hasReferences) taskScore += 0.1;

      const taskProgress = this.progress.get(task.id);
      const hasToolCalls = taskProgress?.toolCalls && taskProgress.toolCalls.length > 0;
      if (hasToolCalls) taskScore += 0.15;

      const isProfessional = !/我不知道|无法回答|抱歉|无法完成/.test(result);
      if (isProfessional) taskScore += 0.15;

      totalScore += Math.min(1, taskScore);
    }

    return taskCount > 0 ? totalScore / taskCount : 0;
  }

  private async replanForIteration(
    currentPlan: DeepPlan,
    score: number,
    results: Map<string, string>
  ): Promise<DeepPlan> {
    const weakTasks = currentPlan.subTasks.filter((task) => {
      const result = results.get(task.id);
      return !result || result.length < 500;
    });

    if (weakTasks.length > 0 && score < 0.5) {
      try {
        const replanPrompt = `以下任务执行结果不达标，请重新规划这些任务，给出更详细的执行策略：

${weakTasks.map((t) => `- ${t.title}: ${results.get(t.id)?.substring(0, 200) || '无输出'}`).join('\n')}

请返回JSON格式的改进建议，包含每个任务的改进方向和更详细的prompt。`;

        const response = await this.llmClient.chat.completions.create({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: '你是任务规划优化专家。分析失败原因并给出改进建议。返回JSON格式。' },
            { role: 'user', content: replanPrompt },
          ],
          temperature: 0.3,
          max_tokens: 2048,
        });

        if (response.usage) {
          this.totalTokens += response.usage.total_tokens;
        }

        const suggestionText = response.choices[0]?.message?.content || '';
        void suggestionText;
      } catch {}
    }

    const improvedSubTasks = currentPlan.subTasks.map((task) => {
      const result = results.get(task.id);
      const isWeak = !result || result.length < 500;

      return {
        ...task,
        assignedAgentPrompt: isWeak
          ? `${task.assignedAgentPrompt}\n\n【重要】上一轮输出不够详细。你必须：1) 主动调用工具搜索真实数据；2) 输出至少2000字；3) 包含具体数据、案例分析和专业洞察；4) 引用信息来源。`
          : task.assignedAgentPrompt,
        priority: isWeak ? 'high' as const : task.priority,
      };
    });

    return { ...currentPlan, subTasks: improvedSubTasks };
  }

  private async synthesizeResults(plan: DeepPlan): Promise<string> {
    let output = `# ${plan.goal}\n\n`;
    output += `> 本报告由 Pi Multi-Agent 系统自动生成\n`;
    output += `> 协作模式: ${plan.collaborationMode} | 通信结构: ${plan.communicationStructure}\n`;
    output += `> 生成时间: ${new Date().toLocaleString('zh-CN')}\n`;
    output += `> Agent数量: ${plan.subTasks.length} | 总Token消耗: ${this.totalTokens}\n\n---\n\n`;

    output += `## 目录\n\n`;
    for (let i = 0; i < plan.subTasks.length; i++) {
      const task = plan.subTasks[i];
      if (task) {
        output += `${i + 1}. [${task.assignedAgentName}] ${task.title}\n`;
      }
    }
    output += `\n---\n\n`;

    for (const task of plan.subTasks) {
      const result = this.results.get(task.id);
      const taskProgress = this.progress.get(task.id);
      const toolCallCount = taskProgress?.toolCalls?.length || 0;

      output += `## ${task.title}\n\n`;
      output += `*执行者: ${task.assignedAgentName} (${task.assignedAgentType}) | 优先级: ${task.priority} | 工具调用: ${toolCallCount}次*\n\n`;

      if (taskProgress?.toolCalls && taskProgress.toolCalls.length > 0) {
        output += `<details><summary>🔧 工具调用记录 (${toolCallCount}次)</summary>\n\n`;
        for (const tc of taskProgress.toolCalls) {
          output += `- **${tc.toolName}** ${tc.success ? '✅' : '❌'} (${tc.duration}ms)\n`;
          output += `  - 输入: \`${JSON.stringify(tc.input).substring(0, 200)}\`\n`;
          output += `  - 输出: ${tc.output.substring(0, 200)}...\n\n`;
        }
        output += `</details>\n\n`;
      }

      output += result || '(无输出)';
      output += `\n\n---\n\n`;
    }

    output += `## 附录\n\n`;
    output += `### 执行统计\n\n`;
    output += `| 指标 | 值 |\n|---|---|\n`;
    output += `| 总任务数 | ${plan.subTasks.length} |\n`;
    output += `| 总Token消耗 | ${this.totalTokens} |\n`;
    output += `| 协作模式 | ${plan.collaborationMode} |\n`;
    output += `| 通信结构 | ${plan.communicationStructure} |\n`;

    const totalToolCalls = Array.from(this.progress.values()).reduce((sum, p) => sum + (p.toolCalls?.length || 0), 0);
    output += `| 工具调用总次数 | ${totalToolCalls} |\n`;

    output += `\n### Agent执行详情\n\n`;
    output += `| Agent | 任务 | 状态 | 输出长度 | 工具调用 |\n|---|---|---|---|---|\n`;
    for (const task of plan.subTasks) {
      const p = this.progress.get(task.id);
      output += `| ${task.assignedAgentName} | ${task.title.substring(0, 20)} | ${p?.status || 'unknown'} | ${p?.outputLength || 0} | ${p?.toolCalls?.length || 0} |\n`;
    }

    return output;
  }

  getProgress(): AgentClusterProgress[] {
    return Array.from(this.progress.values());
  }
}
