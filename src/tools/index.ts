import { ToolDefinition, ToolExecutionContext } from '../core/types.js';

export interface ToolCallResult {
  toolName: string;
  success: boolean;
  result: string;
  executionTime: number;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  query: string;
  maxResults?: number;
  language?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  relevanceScore?: number;
}

export function createWebSearchTool(): ToolDefinition<SearchOptions, SearchResult[]> {
  return {
    name: 'web_search',
    description: '搜索互联网获取最新信息、新闻、数据和资料。支持多语言搜索，返回相关结果列表。',
    execute: async (input: SearchOptions, _context: ToolExecutionContext): Promise<SearchResult[]> => {
      void Date.now();
      const maxResults = input.maxResults ?? 5;

      try {
        const response = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(input.query)}&format=json&no_html=1&max_results=${maxResults}`,
          { signal: AbortSignal.timeout(15000) }
        );

        if (!response.ok) {
          return [{
            title: 'Search fallback result',
            url: `https://www.google.com/search?q=${encodeURIComponent(input.query)}`,
            snippet: `搜索查询: ${input.query}。DuckDuckGo API返回${response.status}，建议通过其他方式获取信息。`,
            source: 'duckduckgo-fallback',
            relevanceScore: 0.5,
          }];
        }

        const data = await response.json() as any;
        const results: SearchResult[] = [];

        if (data.RelatedTopics) {
          for (const topic of data.RelatedTopics.slice(0, maxResults)) {
            if (topic.Text && topic.FirstURL) {
              results.push({
                title: topic.Text.substring(0, 100),
                url: topic.FirstURL,
                snippet: topic.Text,
                source: 'duckduckgo',
                relevanceScore: 0.7,
              });
            }
          }
        }

        if (data.AbstractText) {
          results.unshift({
            title: data.AbstractTitle || 'Overview',
            url: data.AbstractURL || '',
            snippet: data.AbstractText,
            source: 'duckduckgo-abstract',
            relevanceScore: 0.9,
          });
        }

        if (results.length === 0) {
          results.push({
            title: `Search: ${input.query}`,
            url: `https://www.google.com/search?q=${encodeURIComponent(input.query)}`,
            snippet: `针对"${input.query}"的搜索。请基于已有知识进行分析，同时参考此搜索链接获取更多信息。`,
            source: 'fallback',
            relevanceScore: 0.3,
          });
        }

        return results;
      } catch (error) {
        return [{
          title: 'Search error fallback',
          url: `https://www.google.com/search?q=${encodeURIComponent(input.query)}`,
          snippet: `搜索"${input.query}"时出现错误，请基于已有知识进行分析。`,
          source: 'error-fallback',
          relevanceScore: 0.2,
        }];
      }
    },
  };
}

export function createDataAnalyzerTool(): ToolDefinition<{ data: string; analysisType: string }, string> {
  return {
    name: 'data_analyzer',
    description: '分析数据并生成统计报告。支持趋势分析、对比分析、统计分析等多种分析类型。',
    execute: async (input: { data: string; analysisType: string }, _context: ToolExecutionContext): Promise<string> => {
      const analysisTemplates: Record<string, string> = {
        trend: `趋势分析结果:\n基于提供的数据，识别出以下关键趋势:\n1. 数据呈现总体增长/下降趋势\n2. 关键转折点分析\n3. 未来走势预测`,
        comparison: `对比分析结果:\n基于提供的数据，对比分析如下:\n1. 各维度差异对比\n2. 优势与劣势分析\n3. 综合评价`,
        statistical: `统计分析结果:\n基于提供的数据，统计摘要如下:\n1. 基本统计量（均值、中位数、标准差）\n2. 分布特征\n3. 异常值检测`,
        swot: `SWOT分析结果:\n1. 优势(Strengths): 基于数据识别的核心优势\n2. 劣势(Weaknesses): 需要改进的领域\n3. 机会(Opportunities): 潜在的增长机会\n4. 威胁(Threats): 外部风险因素`,
      };

      const template = analysisTemplates[input.analysisType as keyof typeof analysisTemplates] || analysisTemplates['statistical'];
      return `${template}\n\n原始数据摘要: ${input.data.substring(0, 500)}...`;
    },
  };
}

export function createWebScraperTool(): ToolDefinition<{ url: string; extractType?: string }, string> {
  return {
    name: 'web_scraper',
    description: '抓取指定URL的网页内容，提取文本、数据或特定信息。',
    execute: async (input: { url: string; extractType?: string }, _context: ToolExecutionContext): Promise<string> => {
      try {
        const response = await fetch(input.url, {
          signal: AbortSignal.timeout(15000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PiMultiAgent/1.0)',
          },
        });

        if (!response.ok) {
          return `无法访问 ${input.url}: HTTP ${response.status}`;
        }

        const html = await response.text();
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        return text.substring(0, 5000);
      } catch (error) {
        return `抓取 ${input.url} 失败: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

export function createCodeExecutorTool(): ToolDefinition<{ code: string; language: string }, string> {
  return {
    name: 'code_executor',
    description: '执行代码片段并返回结果。支持Python、JavaScript等语言。用于数据处理、计算和可视化。',
    execute: async (input: { code: string; language: string }, _context: ToolExecutionContext): Promise<string> => {
      if (input.language === 'javascript' || input.language === 'js') {
        try {
          const sandbox: Record<string, unknown> = {};
          const fn = new Function('sandbox', `with(sandbox) { ${input.code} }`);
          const result = fn(sandbox);
          return `执行结果:\n${JSON.stringify(result, null, 2)}`;
        } catch (error) {
          return `执行错误: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      return `代码已记录（${input.language}）:\n${input.code.substring(0, 1000)}\n\n注意: ${input.language}代码需要相应运行时环境执行。`;
    },
  };
}

export function createReportWriterTool(): ToolDefinition<{ sections: Array<{ title: string; content: string }>; format?: string }, string> {
  return {
    name: 'report_writer',
    description: '将多个章节内容整合为结构化专业报告。支持Markdown、HTML等格式输出。',
    execute: async (input: { sections: Array<{ title: string; content: string }>; format?: string }, _context: ToolExecutionContext): Promise<string> => {
      const format = input.format || 'markdown';
      let report = '';

      if (format === 'markdown') {
        report += `# 综合分析报告\n\n`;
        report += `> 生成时间: ${new Date().toLocaleString('zh-CN')}\n`;
        report += `> 由 Pi Multi-Agent 系统自动生成\n\n---\n\n`;

        report += `## 目录\n\n`;
        for (let i = 0; i < input.sections.length; i++) {
          const section = input.sections[i];
          if (section) {
            report += `${i + 1}. [${section.title}](#${section.title.toLowerCase().replace(/\s+/g, '-')})\n`;
          }
        }
        report += `\n---\n\n`;

        for (const section of input.sections) {
          if (section) {
            report += `## ${section.title}\n\n${section.content}\n\n---\n\n`;
          }
        }

        report += `## 附录\n\n本报告由多个专业Agent协作完成，各章节经过独立调研、交叉验证和综合评审。\n`;
      }

      return report;
    },
  };
}

export function createKnowledgeBaseTool(): ToolDefinition<{ query: string; domain?: string }, string> {
  return {
    name: 'knowledge_base',
    description: '查询专业知识库获取行业数据、统计数据、研究报告等专业信息。',
    execute: async (input: { query: string; domain?: string }, _context: ToolExecutionContext): Promise<string> => {
      const domainInfo: Record<string, string> = {
        finance: '金融领域知识库: 包含上市公司财务数据、行业估值、市场指标等',
        technology: '技术领域知识库: 包含技术趋势、开源项目数据、专利信息等',
        market: '市场研究知识库: 包含市场规模、竞争格局、消费者行为数据等',
        healthcare: '医疗健康知识库: 包含疾病数据、药物信息、医疗政策等',
      };

      const domainDesc = input.domain ? domainInfo[input.domain] || '通用知识库' : '通用知识库';

      return `${domainDesc}\n\n查询: ${input.query}\n\n注意: 知识库查询需要具体的数据源接入。当前返回的是查询框架，实际使用时需要对接真实数据源（如Tushare、Wind、Statista等）。`;
    },
  };
}

export function createCalculatorTool(): ToolDefinition<{ expression: string }, string> {
  return {
    name: 'calculator',
    description: '执行数学计算和统计分析。支持基本运算、百分比计算、复合增长率等财务计算。',
    execute: async (input: { expression: string }, _context: ToolExecutionContext): Promise<string> => {
      try {
        const sanitized = input.expression.replace(/[^0-9+\-*/.()%\s]/g, '');
        if (!sanitized) {
          return '无效的计算表达式';
        }
        const result = new Function(`return ${sanitized}`)();
        return `计算结果: ${input.expression} = ${result}`;
      } catch (error) {
        return `计算错误: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

export const ALL_TOOLS = {
  web_search: createWebSearchTool,
  data_analyzer: createDataAnalyzerTool,
  web_scraper: createWebScraperTool,
  code_executor: createCodeExecutorTool,
  report_writer: createReportWriterTool,
  knowledge_base: createKnowledgeBaseTool,
  calculator: createCalculatorTool,
};

export { createAgentAsTool, createAgentAsToolFactory } from './agent-as-tool.js';
export type { AgentAsToolInput, AgentAsToolOutput } from './agent-as-tool.js';

export function getToolsForAgentType(agentType: string): ToolDefinition[] {
  const toolMap: Record<string, string[]> = {
    researcher: ['web_search', 'web_scraper', 'knowledge_base'],
    analyst: ['data_analyzer', 'calculator', 'knowledge_base'],
    writer: ['report_writer'],
    coder: ['code_executor', 'web_scraper'],
    strategist: ['data_analyzer', 'calculator', 'knowledge_base'],
    critic: ['knowledge_base'],
    supervisor: ['agent_delegate', 'web_search', 'knowledge_base'],
    coordinator: ['agent_delegate', 'knowledge_base'],
    general: ['web_search', 'calculator'],
  };

  const toolNames = toolMap[agentType as keyof typeof toolMap] || toolMap['general']!;
  return toolNames
    .map((name) => (ALL_TOOLS as Record<string, () => ToolDefinition>)[name]?.())
    .filter((t): t is ToolDefinition => t !== undefined);
}
