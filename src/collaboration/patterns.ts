import {
  TaskResult,
  AgentContext,
} from '../core/types.js';
import { Agent } from '../core/agent.js';
import { PiAgentError } from '../core/errors.js';

export interface CollaborationResult {
  success: boolean;
  results: TaskResult[];
  finalOutput?: unknown;
  executionTime: number;
}

export abstract class BaseCollaboration {
  protected agents: Agent[];
  protected context: AgentContext;

  constructor(agents: Agent[], context: AgentContext) {
    this.agents = agents;
    this.context = context;
  }

  abstract execute(input: string): Promise<CollaborationResult>;

  protected createExecutionContext(agentIndex: number): AgentContext {
    return {
      ...this.context,
      parentAgentId: this.agents[0]?.id,
      depth: this.context.depth + 1,
      metadata: {
        ...this.context.metadata,
        collaborationType: this.constructor.name,
        agentIndex,
      },
    };
  }
}

export class SequentialHandoffs extends BaseCollaboration {
  async execute(input: string): Promise<CollaborationResult> {
    const startTime = Date.now();
    const results: TaskResult[] = [];
    let currentInput = input;

    for (let i = 0; i < this.agents.length; i++) {
      const agent = this.agents[i];
      if (!agent) continue;
      
      const agentContext = this.createExecutionContext(i);

      try {
        const result = await agent.execute(currentInput, agentContext);
        results.push(result);

        if (result.success && result.data) {
          const data = result.data as { text?: string };
          currentInput = data.text ?? '';
        } else {
          return {
            success: false,
            results,
            executionTime: Date.now() - startTime,
          };
        }
      } catch (error) {
        const agentError: PiAgentError = error instanceof PiAgentError 
          ? error 
          : new PiAgentError(
              error instanceof Error ? error.message : String(error),
              'COLLABORATION_ERROR',
              { agentId: agent.id, recoverable: true, retryable: false, cause: error instanceof Error ? error : undefined }
            );
        
        results.push({
          taskId: agentContext.taskId,
          success: false,
          error: agentError,
          executionTime: Date.now() - startTime,
          agentId: agent.id,
        });

        return {
          success: false,
          results,
          executionTime: Date.now() - startTime,
        };
      }
    }

    return {
      success: true,
      results,
      finalOutput: currentInput,
      executionTime: Date.now() - startTime,
    };
  }
}

export class ParallelProcessing extends BaseCollaboration {
  async execute(input: string): Promise<CollaborationResult> {
    const startTime = Date.now();

    const promises = this.agents.map((agent, index) => {
      const agentContext = this.createExecutionContext(index);
      return agent.execute(input, agentContext);
    });

    const results = await Promise.allSettled(promises);

    const taskResults: TaskResult[] = [];
    let allSuccessful = true;

    for (let i = 0; i < results.length; i++) {
      const resultItem = results[i] as PromiseSettledResult<TaskResult>;
      const agent = this.agents[i];
      if (!agent) continue;

      if (resultItem.status === 'fulfilled') {
        taskResults.push(resultItem.value);
        if (!resultItem.value.success) {
          allSuccessful = false;
        }
      } else {
        const reason = resultItem.reason;
        const agentError: PiAgentError = reason instanceof PiAgentError 
          ? reason 
          : new PiAgentError(
              reason instanceof Error ? reason.message : String(reason),
              'PARALLEL_PROCESSING_ERROR',
              { agentId: agent.id, recoverable: true, retryable: false, cause: reason instanceof Error ? reason : undefined }
            );
        
        taskResults.push({
          taskId: this.context.taskId,
          success: false,
          error: agentError,
          executionTime: Date.now() - startTime,
          agentId: agent.id,
        });
        allSuccessful = false;
      }
    }

    return {
      success: allSuccessful,
      results: taskResults,
      finalOutput: taskResults.filter((r) => r.success).map((r) => r.data),
      executionTime: Date.now() - startTime,
    };
  }
}

export interface DebateMessage {
  agentId: string;
  position: string;
  arguments: string[];
  timestamp: number;
}

export class DebateAndConsensus extends BaseCollaboration {
  private maxRounds: number;
  private consensusThreshold: number;
  private debateHistory: DebateMessage[] = [];

  constructor(
    agents: Agent[],
    context: AgentContext,
    options: { maxRounds?: number; consensusThreshold?: number } = {}
  ) {
    super(agents, context);
    this.maxRounds = options.maxRounds ?? 3;
    this.consensusThreshold = options.consensusThreshold ?? 0.7;
  }

  async execute(input: string): Promise<CollaborationResult> {
    const startTime = Date.now();
    this.debateHistory = [];

    let currentRound = 0;
    let consensusReached = false;
    let finalPosition = '';

    while (currentRound < this.maxRounds && !consensusReached) {
      const roundMessages: DebateMessage[] = [];

      const promises = this.agents.map(async (agent, index) => {
        const agentContext = this.createExecutionContext(index);
        const debatePrompt = this.buildDebatePrompt(input, currentRound, roundMessages);
        
        const result = await agent.execute(debatePrompt, agentContext);
        
        return {
          agentId: agent.id,
          position: result.success && result.data 
            ? (result.data as { text?: string }).text ?? '' 
            : '',
          arguments: this.extractArguments(result),
          timestamp: Date.now(),
        } as DebateMessage;
      });

      const roundResults = await Promise.allSettled(promises);

      for (const result of roundResults) {
        if (result.status === 'fulfilled') {
          roundMessages.push(result.value);
          this.debateHistory.push(result.value);
        }
      }

      finalPosition = this.determineConsensus(roundMessages);
      
      if (finalPosition) {
        consensusReached = this.checkConsensus(roundMessages);
      }

      currentRound++;
    }

    return {
      success: consensusReached,
      results: [],
      finalOutput: {
        consensus: consensusReached,
        position: finalPosition,
        rounds: currentRound,
        history: this.debateHistory,
      },
      executionTime: Date.now() - startTime,
    };
  }

  private buildDebatePrompt(
    originalInput: string,
    round: number,
    previousMessages: DebateMessage[]
  ): string {
    let prompt = `Topic: ${originalInput}\n`;
    prompt += `Round ${round + 1} of ${this.maxRounds}\n\n`;

    if (previousMessages.length > 0) {
      prompt += 'Previous arguments:\n';
      for (const msg of previousMessages) {
        prompt += `[${msg.agentId}]: ${msg.position}\n`;
      }
      prompt += '\nPlease provide your counter-arguments or supporting evidence.\n';
    } else {
      prompt += 'Please present your initial position and key arguments.\n';
    }

    return prompt;
  }

  private extractArguments(result: TaskResult): string[] {
    if (!result.success || !result.data) {
      return [];
    }

    const text = (result.data as { text?: string }).text ?? '';
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    
    return sentences.slice(0, 5);
  }

  private determineConsensus(messages: DebateMessage[]): string {
    const positions = messages.map((m) => m.position.toLowerCase().trim());
    
    const frequency: Map<string, number> = new Map();
    for (const pos of positions) {
      const count = frequency.get(pos) ?? 0;
      frequency.set(pos, count + 1);
    }

    let maxCount = 0;
    let consensusPosition = '';

    for (const [pos, count] of frequency) {
      if (count > maxCount) {
        maxCount = count;
        consensusPosition = pos;
      }
    }

    return consensusPosition;
  }

  private checkConsensus(messages: DebateMessage[]): boolean {
    if (messages.length === 0) {
      return false;
    }

    const position = messages[0]?.position.toLowerCase().trim() ?? '';
    let matchingCount = 0;

    for (const msg of messages) {
      if (msg.position.toLowerCase().trim() === position) {
        matchingCount++;
      }
    }

    return matchingCount / messages.length >= this.consensusThreshold;
  }

  getDebateHistory(): DebateMessage[] {
    return [...this.debateHistory];
  }
}

export interface ExpertContribution {
  expertId: string;
  expertName: string;
  specialty: string;
  contribution: string;
  timestamp: number;
}

export class ExpertTeam extends BaseCollaboration {
  private specialties: string[];
  private contributions: ExpertContribution[] = [];

  constructor(
    agents: Agent[],
    context: AgentContext,
    specialties: string[]
  ) {
    super(agents, context);
    this.specialties = specialties;
  }

  async execute(input: string): Promise<CollaborationResult> {
    const startTime = Date.now();
    this.contributions = [];

    const researchPhase = this.agents.find((a) => 
      a.name.toLowerCase().includes('research') || 
      this.specialties[0]?.toLowerCase().includes('research')
    );
    
    const analysisPhase = this.agents.find((a) => 
      a.name.toLowerCase().includes('analyst') || 
      this.specialties[1]?.toLowerCase().includes('analysis')
    );
    
    const writingPhase = this.agents.find((a) => 
      a.name.toLowerCase().includes('writer') || 
      this.specialties[2]?.toLowerCase().includes('writing')
    );

    let researchResult: TaskResult | null = null;
    let analysisResult: TaskResult | null = null;
    let writingResult: TaskResult | null = null;

    if (researchPhase) {
      const result = await researchPhase.execute(input, this.createExecutionContext(0));
      researchResult = result;
      
      if (result.success && result.data) {
        this.contributions.push({
          expertId: researchPhase.id,
          expertName: researchPhase.name,
          specialty: this.specialties[0] ?? 'Research',
          contribution: (result.data as { text?: string }).text ?? '',
          timestamp: Date.now(),
        });
      }
    }

    if (analysisPhase && researchResult?.success) {
      const researchText = (researchResult.data as { text?: string }).text ?? '';
      const result = await analysisPhase.execute(
        `Based on the following research:\n${researchText}`,
        this.createExecutionContext(1)
      );
      analysisResult = result;

      if (result.success && result.data) {
        this.contributions.push({
          expertId: analysisPhase.id,
          expertName: analysisPhase.name,
          specialty: this.specialties[1] ?? 'Analysis',
          contribution: (result.data as { text?: string }).text ?? '',
          timestamp: Date.now(),
        });
      }
    }

    if (writingPhase && analysisResult?.success) {
      const analysisText = (analysisResult.data as { text?: string }).text ?? '';
      const result = await writingPhase.execute(
        `Based on the following analysis:\n${analysisText}`,
        this.createExecutionContext(2)
      );
      writingResult = result;

      if (result.success && result.data) {
        this.contributions.push({
          expertId: writingPhase.id,
          expertName: writingPhase.name,
          specialty: this.specialties[2] ?? 'Writing',
          contribution: (result.data as { text?: string }).text ?? '',
          timestamp: Date.now(),
        });
      }
    }

    return {
      success: writingResult?.success ?? false,
      results: [researchResult, analysisResult, writingResult].filter((r): r is TaskResult => r !== null),
      finalOutput: writingResult?.success ? writingResult.data : undefined,
      executionTime: Date.now() - startTime,
    };
  }

  getContributions(): ExpertContribution[] {
    return [...this.contributions];
  }
}

export interface ReviewResult {
  approved: boolean;
  issues: string[];
  suggestions: string[];
}

export class CriticReviewer extends BaseCollaboration {
  private creatorAgent: Agent;
  private reviewerAgent: Agent;
  private maxReviewRounds: number;

  constructor(
    creator: Agent,
    reviewer: Agent,
    context: AgentContext,
    options: { maxReviewRounds?: number } = {}
  ) {
    super([creator, reviewer], context);
    this.creatorAgent = creator;
    this.reviewerAgent = reviewer;
    this.maxReviewRounds = options.maxReviewRounds ?? 2;
  }

  async execute(input: string): Promise<CollaborationResult> {
    const startTime = Date.now();
    let currentDraft = '';
    let reviewRound = 0;
    let finalResult: TaskResult | null = null;

    while (reviewRound < this.maxReviewRounds) {
      const creatorContext = this.createExecutionContext(0);
      
      const creationPrompt = reviewRound === 0 
        ? input 
        : `Improve the following draft based on feedback:\n\nPrevious draft:\n${currentDraft}\n\nReview feedback:\n${currentDraft}`;

      const creationResult = await this.creatorAgent.execute(creationPrompt, creatorContext);
      
      if (!creationResult.success) {
        return {
          success: false,
          results: [creationResult],
          executionTime: Date.now() - startTime,
        };
      }

      currentDraft = (creationResult.data as { text?: string }).text ?? '';

      const reviewerContext = this.createExecutionContext(1);
      const reviewResult = await this.reviewerAgent.execute(
        `Review the following content and provide feedback:\n\n${currentDraft}`,
        reviewerContext
      );

      if (!reviewResult.success) {
        return {
          success: false,
          results: [creationResult, reviewResult],
          executionTime: Date.now() - startTime,
        };
      }

      const reviewAnalysis = this.analyzeReview(reviewResult);
      
      if (reviewAnalysis.approved) {
        finalResult = creationResult;
        break;
      }

      reviewRound++;
    }

    return {
      success: finalResult !== null,
      results: [],
      finalOutput: currentDraft,
      executionTime: Date.now() - startTime,
    };
  }

  private analyzeReview(reviewResult: TaskResult): ReviewResult {
    const text = (reviewResult.data as { text?: string }).text ?? '';
    
    const hasApproval = /approved|accepted|good|acceptable|lgtm/i.test(text);
    const hasRejection = /reject|need.*improve|not.*acceptable|major.*issue/i.test(text);

    const issues: string[] = [];
    const suggestions: string[] = [];

    const lines = text.split('\n');
    for (const line of lines) {
      if (/issue|problem|concern/i.test(line)) {
        issues.push(line.trim());
      }
      if (/suggest|recommend|try|consider/i.test(line)) {
        suggestions.push(line.trim());
      }
    }

    return {
      approved: hasApproval && !hasRejection,
      issues,
      suggestions,
    };
  }
}

export class HierarchicalCollaboration extends BaseCollaboration {
  private supervisorAgent: Agent;
  private subordinateAgents: Agent[];

  constructor(
    supervisor: Agent,
    subordinates: Agent[],
    context: AgentContext,
    _options: { maxDepth?: number } = {}
  ) {
    super([supervisor, ...subordinates], context);
    this.supervisorAgent = supervisor;
    this.subordinateAgents = subordinates;
  }

  async execute(input: string): Promise<CollaborationResult> {
    const startTime = Date.now();
    
    const supervisorContext = this.createExecutionContext(0);
    const supervisorResult = await this.supervisorAgent.execute(input, supervisorContext);

    if (!supervisorResult.success) {
      return {
        success: false,
        results: [supervisorResult],
        executionTime: Date.now() - startTime,
      };
    }

    const subtasks = this.parseSubtasks(supervisorResult);
    
    if (subtasks.length === 0) {
      return {
        success: true,
        results: [supervisorResult],
        finalOutput: supervisorResult.data,
        executionTime: Date.now() - startTime,
      };
    }

    const taskAssignments = this.assignTasksToSubordinates(subtasks);
    const subordinateResults = await this.executeSubordinateTasks(taskAssignments);

    const synthesisContext = this.createExecutionContext(1);
    const synthesisPrompt = this.buildSynthesisPrompt(subordinateResults);
    const synthesisResult = await this.supervisorAgent.execute(synthesisPrompt, synthesisContext);

    return {
      success: synthesisResult.success,
      results: [supervisorResult, synthesisResult, ...subordinateResults],
      finalOutput: synthesisResult.data,
      executionTime: Date.now() - startTime,
    };
  }

  private parseSubtasks(result: TaskResult): string[] {
    const text = (result.data as { text?: string }).text ?? '';
    
    const subtaskPatterns = [
      /^\d+\.\s*(.+)$/gm,
      /^[-*]\s*(.+)$/gm,
      /^Task\s*\d+:\s*(.+)$/gi,
    ];

    for (const pattern of subtaskPatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        return matches.map((m) => m.replace(/^\d+\.\s*|^[-*]\s*|^Task\s*\d+:\s*/i, '').trim());
      }
    }

    return [];
  }

  private assignTasksToSubordinates(tasks: string[]): Array<{ task: string; agent: Agent }> {
    const assignments: Array<{ task: string; agent: Agent }> = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const agent = this.subordinateAgents[i % this.subordinateAgents.length];
      if (task && agent) {
        assignments.push({ task, agent });
      }
    }

    return assignments;
  }

  private async executeSubordinateTasks(
    assignments: Array<{ task: string; agent: Agent }>
  ): Promise<TaskResult[]> {
    const promises = assignments.map(({ task, agent }, index) =>
      agent.execute(task, this.createExecutionContext(index + 1))
    );

    const results = await Promise.allSettled(promises);

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      
      const assignment = assignments[index];
      const agentError: PiAgentError = result.reason instanceof PiAgentError 
        ? result.reason 
        : new PiAgentError(
            result.reason instanceof Error ? result.reason.message : String(result.reason),
            'HIERARCHICAL_COLLABORATION_ERROR',
            { agentId: assignment?.agent.id, recoverable: true, retryable: false, cause: result.reason instanceof Error ? result.reason : undefined }
          );
      
      return {
        taskId: this.context.taskId,
        success: false,
        error: agentError,
        executionTime: 0,
        agentId: assignment?.agent.id ?? '',
      };
    });
  }

  private buildSynthesisPrompt(results: TaskResult[]): string {
    let prompt = 'Synthesize the following subordinate results into a cohesive final output:\n\n';

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result) {
        const data = result.data as { text?: string };
        prompt += `--- Subordinate ${i + 1} Result ---\n${data?.text ?? 'No output'}\n\n`;
      }
    }

    prompt += '\nPlease provide a unified, coherent response that incorporates all the above contributions.';

    return prompt;
  }
}
