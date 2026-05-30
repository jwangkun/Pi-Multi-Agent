import {
  EvaluationResult,
  EvaluationDimension,
  ReflectionResult,
  Issue,
  Recommendation,
  TaskResult,
} from '../core/types.js';

export interface EvaluatorConfig {
  dimensions?: EvaluationDimension[];
  passThreshold?: number;
  enableReflection?: boolean;
  maxReflectionIterations?: number;
}

export class Evaluator {
  private config: Required<EvaluatorConfig>;
  private defaultDimensions: EvaluationDimension[];

  constructor(config: EvaluatorConfig = {}) {
    this.config = {
      dimensions: config.dimensions ?? [],
      passThreshold: config.passThreshold ?? 0.7,
      enableReflection: config.enableReflection ?? true,
      maxReflectionIterations: config.maxReflectionIterations ?? 3,
    };

    this.defaultDimensions = [
      {
        name: 'accuracy',
        score: 0,
        weight: 0.3,
        description: 'Task output correctness and factual accuracy',
        passed: false,
      },
      {
        name: 'completeness',
        score: 0,
        weight: 0.25,
        description: 'All required aspects are addressed',
        passed: false,
      },
      {
        name: 'coherence',
        score: 0,
        weight: 0.2,
        description: 'Logical consistency and flow',
        passed: false,
      },
      {
        name: 'quality',
        score: 0,
        weight: 0.15,
        description: 'Overall output quality and professionalism',
        passed: false,
      },
      {
        name: 'format',
        score: 0,
        weight: 0.1,
        description: 'Proper formatting and structure',
        passed: false,
      },
    ];
  }

  async evaluate(
    result: TaskResult,
    expectedOutput?: unknown
  ): Promise<EvaluationResult> {
    if (!result.success) {
      return {
        passed: false,
        score: 0,
        dimensions: this.defaultDimensions.map((d) => ({
          ...d,
          score: 0,
          passed: false,
        })),
        feedback: `Task failed with error: ${result.error?.message ?? 'Unknown error'}`,
        suggestions: ['Investigate the failure reason', 'Review task setup', 'Consider retry'],
      };
    }

    const dimensions = this.config.dimensions.length > 0 
      ? this.config.dimensions 
      : this.defaultDimensions;

    const evaluatedDimensions = await this.evaluateDimensions(
      result,
      expectedOutput,
      dimensions
    );

    const totalScore = this.calculateWeightedScore(evaluatedDimensions);
    const passed = totalScore >= this.config.passThreshold;

    const feedback = this.generateFeedback(evaluatedDimensions, totalScore, passed);

    return {
      passed,
      score: totalScore,
      dimensions: evaluatedDimensions,
      feedback,
      suggestions: this.generateSuggestions(evaluatedDimensions),
    };
  }

  private async evaluateDimensions(
    result: TaskResult,
    expectedOutput: unknown | undefined,
    dimensions: EvaluationDimension[]
  ): Promise<EvaluationDimension[]> {
    return dimensions.map((dimension) => {
      let score: number;
      let passed: boolean;

      switch (dimension.name) {
        case 'accuracy':
          score = this.evaluateAccuracy(result, expectedOutput);
          break;
        case 'completeness':
          score = this.evaluateCompleteness(result);
          break;
        case 'coherence':
          score = this.evaluateCoherence(result);
          break;
        case 'quality':
          score = this.evaluateQuality(result);
          break;
        case 'format':
          score = this.evaluateFormat(result);
          break;
        default:
          score = 0.5;
      }

      passed = score >= this.config.passThreshold;

      return {
        ...dimension,
        score,
        passed,
      };
    });
  }

  private evaluateAccuracy(result: TaskResult, expectedOutput?: unknown): number {
    if (!result.success || !result.data) {
      return 0;
    }

    if (expectedOutput === undefined) {
      return 0.7;
    }

    const dataStr = JSON.stringify(result.data);
    const expectedStr = JSON.stringify(expectedOutput);

    if (dataStr === expectedStr) {
      return 1.0;
    }

    const similarity = this.calculateStringSimilarity(dataStr, expectedStr);
    return Math.max(0, similarity);
  }

  private evaluateCompleteness(result: TaskResult): number {
    if (!result.success || !result.data) {
      return 0;
    }

    const data = result.data as { text?: string };
    if (typeof data.text === 'string') {
      const words = data.text.split(/\s+/).filter((w) => w.length > 0).length;
      
      if (words >= 500) return 1.0;
      if (words >= 200) return 0.8;
      if (words >= 100) return 0.6;
      if (words >= 50) return 0.4;
      return 0.2;
    }

    return 0.7;
  }

  private evaluateCoherence(result: TaskResult): number {
    if (!result.success || !result.data) {
      return 0;
    }

    const data = result.data as { text?: string };
    if (typeof data.text === 'string') {
      const text = data.text;
      
      const hasStructure = /\n/.test(text) || /#{1,6}\s/.test(text);
      const hasFlow = /首先|其次|最后|因此|然而|此外|同时/.test(text) || 
                      /first|second|third|therefore|however|furthermore|meanwhile/.test(text);

      if (hasStructure && hasFlow) return 0.9;
      if (hasStructure || hasFlow) return 0.7;
      return 0.5;
    }

    return 0.7;
  }

  private evaluateQuality(result: TaskResult): number {
    if (!result.success || !result.data) {
      return 0;
    }

    const data = result.data as { text?: string };
    if (typeof data.text === 'string') {
      const text = data.text;
      
      const hasDepth = text.length >= 500;
      const hasExamples = /例如|比如|比如|案例|example|case/.test(text);
      const isProfessional = !/哈哈|嘿嘿|呀|啊/.test(text);

      let score = 0.5;
      if (hasDepth) score += 0.15;
      if (hasExamples) score += 0.15;
      if (isProfessional) score += 0.2;

      return Math.min(1, score);
    }

    return 0.7;
  }

  private evaluateFormat(result: TaskResult): number {
    if (!result.success || !result.data) {
      return 0;
    }

    const data = result.data as { text?: string };
    if (typeof data.text === 'string') {
      const text = data.text;
      
      const hasHeaders = /#{1,6}\s/.test(text);
      const hasLists = /^[\s]*[-*]\s|^[\s]*\d+\.\s/m.test(text);
      const hasParagraphs = /\n\n/.test(text);

      if (hasHeaders && hasLists && hasParagraphs) return 1.0;
      if ((hasHeaders || hasLists) && hasParagraphs) return 0.8;
      if (hasHeaders || hasLists) return 0.6;
      return 0.4;
    }

    return 0.7;
  }

  private calculateStringSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) {
      return 1.0;
    }

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = Array.from({ length: str2.length + 1 }, () => 
      new Array(str1.length + 1).fill(0)
    );

    for (let i = 0; i <= str2.length; i++) {
      const row = matrix[i];
      if (row) row[0] = i;
    }

    for (let j = 0; j <= str1.length; j++) {
      const row0 = matrix[0];
      if (row0) row0[j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        const previousRow = matrix[i - 1];
        const currentRow = matrix[i];
        if (!previousRow || !currentRow) continue;
        
        if (str2[i - 1] === str1[j - 1]) {
          currentRow[j] = previousRow[j - 1] ?? 0;
        } else {
          currentRow[j] = Math.min(
            (previousRow[j - 1] ?? 0) + 1,
            (currentRow[j - 1] ?? 0) + 1,
            (previousRow[j] ?? 0) + 1
          );
        }
      }
    }

    const lastRow = matrix[str2.length];
    if (!lastRow) return 0;
    
    const result = lastRow[str1.length];
    return result ?? 0;
  }

  private calculateWeightedScore(dimensions: EvaluationDimension[]): number {
    let totalScore = 0;
    let totalWeight = 0;

    for (const dimension of dimensions) {
      totalScore += dimension.score * dimension.weight;
      totalWeight += dimension.weight;
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  private generateFeedback(
    dimensions: EvaluationDimension[],
    totalScore: number,
    passed: boolean
  ): string {
    const passedDimensions = dimensions.filter((d) => d.passed).map((d) => d.name);
    const failedDimensions = dimensions.filter((d) => !d.passed).map((d) => d.name);

    let feedback = passed
      ? `Task completed successfully with overall score: ${(totalScore * 100).toFixed(1)}%`
      : `Task did not meet quality threshold. Score: ${(totalScore * 100).toFixed(1)}%`;

    if (passedDimensions.length > 0) {
      feedback += `\nStrengths: ${passedDimensions.join(', ')}`;
    }

    if (failedDimensions.length > 0) {
      feedback += `\nAreas for improvement: ${failedDimensions.join(', ')}`;
    }

    return feedback;
  }

  private generateSuggestions(dimensions: EvaluationDimension[]): string[] {
    const suggestions: string[] = [];

    for (const dimension of dimensions) {
      if (!dimension.passed) {
        switch (dimension.name) {
          case 'accuracy':
            suggestions.push('Review facts and verify information sources');
            break;
          case 'completeness':
            suggestions.push('Add more detail and cover additional aspects');
            break;
          case 'coherence':
            suggestions.push('Improve logical flow and structure');
            break;
          case 'quality':
            suggestions.push('Enhance depth and use concrete examples');
            break;
          case 'format':
            suggestions.push('Use proper formatting with headers and lists');
            break;
        }
      }
    }

    return suggestions;
  }

  async reflect(
    _result: TaskResult,
    evaluation: EvaluationResult
  ): Promise<ReflectionResult> {
    const issues: Issue[] = [];
    const recommendations: Recommendation[] = [];

    for (const dimension of evaluation.dimensions) {
      if (!dimension.passed) {
        issues.push({
          severity: dimension.score < 0.5 ? 'critical' : 'major',
          category: dimension.name,
          description: `Score ${(dimension.score * 100).toFixed(0)}% - below threshold`,
          suggestion: this.getSuggestion(dimension.name),
        });

        recommendations.push({
          priority: dimension.weight,
          action: this.getAction(dimension.name),
          rationale: `${dimension.description} needs improvement`,
          expectedImpact: `Increase ${dimension.name} score by ${Math.round((this.config.passThreshold - dimension.score) * 100)}%`,
        });
      }
    }

    const shouldRetry = !evaluation.passed && issues.length > 0 && issues[0]?.severity !== 'critical';

    return {
      success: evaluation.passed,
      analysis: this.generateAnalysis(issues, evaluation),
      issues,
      recommendations: recommendations.sort((a, b) => b.priority - a.priority),
      shouldRetry,
      newPlan: undefined,
    };
  }

  private getSuggestion(dimensionName: string): string | undefined {
    const suggestions: Record<string, string> = {
      accuracy: 'Double-check facts and cross-reference sources',
      completeness: 'Expand content to cover all required aspects',
      coherence: 'Restructure to improve logical flow',
      quality: 'Add depth and concrete examples',
      format: 'Apply proper formatting conventions',
    };
    return suggestions[dimensionName];
  }

  private getAction(dimensionName: string): string {
    const actions: Record<string, string> = {
      accuracy: 'Review and verify all factual claims',
      completeness: 'Add missing sections or expand existing content',
      coherence: 'Reorganize structure and add transitions',
      quality: 'Enhance with examples and deeper analysis',
      format: 'Apply consistent formatting with headers and lists',
    };
    return actions[dimensionName] ?? 'General improvement needed';
  }

  private generateAnalysis(issues: Issue[], evaluation: EvaluationResult): string {
    if (issues.length === 0) {
      return 'All evaluation dimensions passed. Task completed successfully.';
    }

    const criticalIssues = issues.filter((i) => i.severity === 'critical');
    const majorIssues = issues.filter((i) => i.severity === 'major');

    let analysis = `Analysis of task results (overall score: ${(evaluation.score * 100).toFixed(1)}%):\n`;

    if (criticalIssues.length > 0) {
      analysis += `\nCritical issues requiring immediate attention:\n`;
      for (const issue of criticalIssues) {
        analysis += `- [${issue.category}] ${issue.description}\n`;
      }
    }

    if (majorIssues.length > 0) {
      analysis += `\nMajor issues to address:\n`;
      for (const issue of majorIssues) {
        analysis += `- [${issue.category}] ${issue.description}\n`;
      }
    }

    return analysis;
  }
}
