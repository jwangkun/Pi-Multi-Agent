import OpenAI from 'openai';
import { LLM_DEFAULTS } from '../core/llm-config.js';
import { ToolDefinition, ToolExecutionContext } from '../core/types.js';

export interface AgentAsToolInput {
  task: string;
  agentType: string;
  agentName?: string;
  context?: string;
  maxTokens?: number;
}

export interface AgentAsToolOutput {
  agentName: string;
  agentType: string;
  task: string;
  result: string;
  tokensUsed: number;
  executionTime: number;
  success: boolean;
  error?: string;
}

export function createAgentAsTool(
  apiKey: string,
  baseURL: string = LLM_DEFAULTS.baseURL,
  model: string = LLM_DEFAULTS.model
): ToolDefinition<AgentAsToolInput, AgentAsToolOutput> {
  const llmClient = new OpenAI({ apiKey, baseURL });

  const agentPrompts: Record<string, string> = {
    researcher: `你是一个专业的研究员Agent。你的职责是深入调研指定主题，收集数据和信息，提供全面、客观的研究报告。请确保：
1. 信息来源可靠
2. 数据准确有据
3. 分析逻辑清晰
4. 结论有支撑`,

    analyst: `你是一个专业的数据分析师Agent。你的职责是分析数据、发现趋势、提供洞察。请确保：
1. 数据分析方法科学
2. 统计指标使用正确
3. 趋势判断有依据
4. 建议可操作`,

    writer: `你是一个专业的报告撰写Agent。你的职责是将研究结果和数据整合成结构清晰、逻辑严谨的专业报告。请确保：
1. 结构层次分明
2. 论证逻辑严密
3. 语言专业规范
4. 结论明确有力`,

    critic: `你是一个专业的评审Agent。你的职责是对内容进行质量评估，指出问题和不足，提供改进建议。请确保：
1. 评估标准明确
2. 问题定位准确
3. 建议具体可行
4. 评价客观公正`,

    strategist: `你是一个专业的战略分析师Agent。你的职责是基于研究和分析结果，制定战略建议和行动计划。请确保：
1. 战略方向明确
2. 路径规划合理
3. 风险评估充分
4. 资源配置可行`,
  };

  return {
    name: 'agent_delegate',
    description: `调用一个专业子Agent来执行特定任务。子Agent拥有独立的专业能力和知识，可以完成研究、分析、撰写、评审等任务。
可用Agent类型：
- researcher: 深度调研，收集数据和信息
- analyst: 数据分析，发现趋势和洞察
- writer: 报告撰写，整合内容
- critic: 质量评审，指出问题和改进建议
- strategist: 战略分析，制定行动计划

输入参数：
- task: 要子Agent执行的具体任务描述
- agentType: 子Agent类型（researcher/analyst/writer/critic/strategist）
- agentName: 子Agent名称（可选）
- context: 上下文信息（可选）
- maxTokens: 最大输出token数（可选，默认4096）`,

    inputSchema: {
      properties: {
        task: { type: 'string', description: '要子Agent执行的具体任务描述' },
        agentType: { type: 'string', description: '子Agent类型: researcher/analyst/writer/critic/strategist' },
        agentName: { type: 'string', description: '子Agent名称（可选）' },
        context: { type: 'string', description: '上下文信息（可选）' },
        maxTokens: { type: 'number', description: '最大输出token数（可选）' },
      },
      required: ['task', 'agentType'],
    } as unknown as AgentAsToolInput,

    execute: async (input: AgentAsToolInput, _context: ToolExecutionContext): Promise<AgentAsToolOutput> => {
      const startTime = Date.now();
      const agentName = input.agentName || `${input.agentType}_agent`;
      const systemPrompt = agentPrompts[input.agentType] || agentPrompts['researcher']!;
      const maxTokens = input.maxTokens || 4096;

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
      ];

      if (input.context) {
        messages.push({
          role: 'system',
          content: `以下是调用方提供的上下文信息，请参考：\n\n${input.context}`,
        });
      }

      messages.push({
        role: 'user',
        content: input.task,
      });

      try {
        const response = await llmClient.chat.completions.create({
          model,
          messages,
          temperature: 0.7,
          max_tokens: maxTokens,
        });

        const result = response.choices[0]?.message?.content || '';
        const tokensUsed = response.usage?.total_tokens || 0;
        const executionTime = Date.now() - startTime;

        return {
          agentName,
          agentType: input.agentType,
          task: input.task,
          result,
          tokensUsed,
          executionTime,
          success: true,
        };
      } catch (error) {
        return {
          agentName,
          agentType: input.agentType,
          task: input.task,
          result: '',
          tokensUsed: 0,
          executionTime: Date.now() - startTime,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

export function createAgentAsToolFactory(
  apiKey: string,
  baseURL: string = LLM_DEFAULTS.baseURL,
  model: string = LLM_DEFAULTS.model
): () => ToolDefinition<AgentAsToolInput, AgentAsToolOutput> {
  return () => createAgentAsTool(apiKey, baseURL, model);
}
