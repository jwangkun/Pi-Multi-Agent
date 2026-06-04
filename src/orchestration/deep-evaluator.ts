import OpenAI from 'openai';
import { LLM_DEFAULTS } from '../core/llm-config';

export interface DeepEvaluationDimension {
  name: string;
  score: number;
  maxScore: number;
  weight: number;
  passed: boolean;
  feedback: string;
  details: string[];
}

export interface DeepEvaluationResult {
  passed: boolean;
  overallScore: number;
  dimensions: DeepEvaluationDimension[];
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  shouldRetry: boolean;
  retryFocus: string[];
}

export class DeepEvaluator {
  private llmClient: OpenAI;

  private model: string;

  constructor(apiKey: string, baseURL: string = LLM_DEFAULTS.baseURL, model: string = LLM_DEFAULTS.model) {
    this.llmClient = new OpenAI({ apiKey, baseURL });
    this.model = model;
  }

  async evaluate(
    output: string,
    goal: string,
    options?: {
      targetWordCount?: number;
      minSections?: number;
      requireDataSupport?: boolean;
      requireReferences?: boolean;
      passThreshold?: number;
    }
  ): Promise<DeepEvaluationResult> {
    const targetWordCount = options?.targetWordCount ?? 30000;
    const minSections = options?.minSections ?? 5;
    const passThreshold = options?.passThreshold ?? 0.7;

    const outputPreview = output.length > 8000
      ? output.substring(0, 4000) + '\n\n[...中间内容省略...]\n\n' + output.substring(output.length - 4000)
      : output;

    const charCount = output.length;
    const estimatedWordCount = Math.round(charCount / 2);
    const sectionCount = (output.match(/^#{1,3}\s/mg) || []).length;
    const hasDataReferences = /数据|统计|报告|研究|调查|来源|引用|参考/.test(output);
    const hasBulletPoints = /^[\s]*[-*]\s|^[\s]*\d+\.\s/m.test(output);
    const hasTables = /\|.*\|.*\|/.test(output);

    const evaluationPrompt = `你是一个顶级的内容质量评估专家。请对以下报告进行严格的四维评估。

## 评估目标
${goal}

## 报告基本信息
- 字符数: ${charCount.toLocaleString()}
- 估算字数: ${estimatedWordCount.toLocaleString()} (中文)
- 章节数: ${sectionCount}
- 目标字数: ${targetWordCount.toLocaleString()}
- 最低章节数: ${minSections}
- 包含数据引用: ${hasDataReferences}
- 包含列表: ${hasBulletPoints}
- 包含表格: ${hasTables}

## 报告内容预览
${outputPreview}

## 评估维度

### 1. 准确性 (Accuracy) - 权重30%
- 事实陈述是否准确
- 数据引用是否可靠
- 逻辑推理是否严密
- 是否存在明显的事实错误

### 2. 完整性 (Completeness) - 权重30%
- 是否覆盖了目标的所有方面
- 字数是否达到目标（${targetWordCount.toLocaleString()}字）
- 章节是否足够（至少${minSections}个）
- 是否有遗漏的重要主题

### 3. 一致性 (Consistency) - 权重20%
- 各章节之间是否逻辑一致
- 论点是否有矛盾
- 风格是否统一
- 数据是否前后一致

### 4. 格式规范 (Format) - 权重20%
- 标题层级是否清晰
- 段落结构是否合理
- 是否使用了列表、表格等格式
- 引用和参考是否规范

## 输出要求
请返回严格的JSON格式，不要有任何其他文字：
{
  "accuracy": {
    "score": 0-100,
    "feedback": "简短评价",
    "details": ["具体问题1", "具体问题2"]
  },
  "completeness": {
    "score": 0-100,
    "feedback": "简短评价",
    "details": ["具体问题1", "具体问题2"]
  },
  "consistency": {
    "score": 0-100,
    "feedback": "简短评价",
    "details": ["具体问题1", "具体问题2"]
  },
  "format": {
    "score": 0-100,
    "feedback": "简短评价",
    "details": ["具体问题1", "具体问题2"]
  },
  "summary": "总体评价",
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["不足1", "不足2"],
  "suggestions": ["建议1", "建议2"],
  "shouldRetry": true/false,
  "retryFocus": ["需要重点改进的方面1", "方面2"]
}`;

    try {
      const response = await this.llmClient.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: '你是一个严格的内容质量评估专家。你必须返回严格的JSON格式，不要有任何其他文字。',
          },
          { role: 'user', content: evaluationPrompt },
        ],
        temperature: 0.2,
        max_tokens: 2048,
      });

      const text = response.choices[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.createFallbackEvaluation(output, goal, targetWordCount, minSections, passThreshold);
      }

      const raw = JSON.parse(jsonMatch[0]);

      const dimensions: DeepEvaluationDimension[] = [
        {
          name: 'accuracy',
          score: raw.accuracy?.score ?? 50,
          maxScore: 100,
          weight: 0.3,
          passed: (raw.accuracy?.score ?? 50) >= passThreshold * 100,
          feedback: raw.accuracy?.feedback || '',
          details: raw.accuracy?.details || [],
        },
        {
          name: 'completeness',
          score: raw.completeness?.score ?? 50,
          maxScore: 100,
          weight: 0.3,
          passed: (raw.completeness?.score ?? 50) >= passThreshold * 100,
          feedback: raw.completeness?.feedback || '',
          details: raw.completeness?.details || [],
        },
        {
          name: 'consistency',
          score: raw.consistency?.score ?? 50,
          maxScore: 100,
          weight: 0.2,
          passed: (raw.consistency?.score ?? 50) >= passThreshold * 100,
          feedback: raw.consistency?.feedback || '',
          details: raw.consistency?.details || [],
        },
        {
          name: 'format',
          score: raw.format?.score ?? 50,
          maxScore: 100,
          weight: 0.2,
          passed: (raw.format?.score ?? 50) >= passThreshold * 100,
          feedback: raw.format?.feedback || '',
          details: raw.format?.details || [],
        },
      ];

      const overallScore = dimensions.reduce((sum, d) => sum + (d.score / d.maxScore) * d.weight, 0);
      const passed = overallScore >= passThreshold;

      return {
        passed,
        overallScore,
        dimensions,
        summary: raw.summary || '',
        strengths: raw.strengths || [],
        weaknesses: raw.weaknesses || [],
        suggestions: raw.suggestions || [],
        shouldRetry: raw.shouldRetry ?? !passed,
        retryFocus: raw.retryFocus || [],
      };
    } catch (error) {
      return this.createFallbackEvaluation(output, goal, targetWordCount, minSections, passThreshold);
    }
  }

  private createFallbackEvaluation(
    output: string,
    _goal: string,
    targetWordCount: number,
    minSections: number,
    passThreshold: number
  ): DeepEvaluationResult {
    const charCount = output.length;
    const estimatedWordCount = Math.round(charCount / 2);
    const sectionCount = (output.match(/^#{1,3}\s/mg) || []).length;

    const wordScore = Math.min(100, (estimatedWordCount / targetWordCount) * 100);
    const sectionScore = Math.min(100, (sectionCount / minSections) * 100);
    const hasStructure = /#{1,3}\s/.test(output) && /\n\n/.test(output);
    const structureScore = hasStructure ? 80 : 40;

    const dimensions: DeepEvaluationDimension[] = [
      {
        name: 'accuracy',
        score: 70,
        maxScore: 100,
        weight: 0.3,
        passed: 70 >= passThreshold * 100,
        feedback: '基于规则的初步评估，需要LLM深度评估确认',
        details: ['自动评估模式，准确性待验证'],
      },
      {
        name: 'completeness',
        score: Math.round(wordScore * 0.6 + sectionScore * 0.4),
        maxScore: 100,
        weight: 0.3,
        passed: (wordScore * 0.6 + sectionScore * 0.4) >= passThreshold * 100,
        feedback: `字数: ${estimatedWordCount}/${targetWordCount} (${Math.round(wordScore)}%), 章节: ${sectionCount}/${minSections} (${Math.round(sectionScore)}%)`,
        details: [`字数达标率: ${Math.round(wordScore)}%`, `章节达标率: ${Math.round(sectionScore)}%`],
      },
      {
        name: 'consistency',
        score: 70,
        maxScore: 100,
        weight: 0.2,
        passed: 70 >= passThreshold * 100,
        feedback: '基于规则的初步评估',
        details: ['自动评估模式'],
      },
      {
        name: 'format',
        score: structureScore,
        maxScore: 100,
        weight: 0.2,
        passed: structureScore >= passThreshold * 100,
        feedback: hasStructure ? '文档结构良好' : '文档结构需要改进',
        details: [hasStructure ? '包含标题和段落' : '缺少标题或段落结构'],
      },
    ];

    const overallScore = dimensions.reduce((sum, d) => sum + (d.score / d.maxScore) * d.weight, 0);

    return {
      passed: overallScore >= passThreshold,
      overallScore,
      dimensions,
      summary: `自动评估: 总分 ${(overallScore * 100).toFixed(0)}%, 字数 ${estimatedWordCount.toLocaleString()}, 章节 ${sectionCount}`,
      strengths: hasStructure ? ['文档结构清晰'] : [],
      weaknesses: estimatedWordCount < targetWordCount ? [`字数不足: ${estimatedWordCount}/${targetWordCount}`] : [],
      suggestions: estimatedWordCount < targetWordCount ? ['增加内容深度和广度'] : [],
      shouldRetry: overallScore < passThreshold,
      retryFocus: overallScore < passThreshold ? ['completeness'] : [],
    };
  }
}
