import OpenAI from 'openai';

export interface LLMAgent {
  id: string;
  name: string;
  type: string;
  systemPrompt: string;
  tools?: string[];
}

export interface LLMAgentResult {
  agentId: string;
  agentName: string;
  output: string;
  tokensUsed: number;
  executionTime: number;
  success: boolean;
  error?: string;
}

export interface LLMAgentCollaborationResult {
  success: boolean;
  mode: string;
  agentResults: LLMAgentResult[];
  finalOutput: string;
  totalTokens: number;
  totalExecutionTime: number;
  iterations: number;
  metadata: Record<string, unknown>;
}

export class LLMAgentCollaboration {
  private llmClient: OpenAI;

  constructor(apiKey: string, baseURL: string = 'https://api.deepseek.com') {
    this.llmClient = new OpenAI({ apiKey, baseURL });
  }

  private async callAgent(agent: LLMAgent, input: string, maxTokens: number = 4096): Promise<LLMAgentResult> {
    const startTime = Date.now();

    try {
      const response = await this.llmClient.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: agent.systemPrompt },
          { role: 'user', content: input },
        ],
        temperature: 0.7,
        max_tokens: maxTokens,
      });

      const output = response.choices[0]?.message?.content || '';
      const tokensUsed = response.usage?.total_tokens || 0;

      return {
        agentId: agent.id,
        agentName: agent.name,
        output,
        tokensUsed,
        executionTime: Date.now() - startTime,
        success: true,
      };
    } catch (error) {
      return {
        agentId: agent.id,
        agentName: agent.name,
        output: '',
        tokensUsed: 0,
        executionTime: Date.now() - startTime,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async executeSequential(agents: LLMAgent[], input: string): Promise<LLMAgentCollaborationResult> {
    const startTime = Date.now();
    const results: LLMAgentResult[] = [];
    let currentInput = input;
    let totalTokens = 0;

    for (const agent of agents) {
      const result = await this.callAgent(agent, currentInput);
      results.push(result);
      totalTokens += result.tokensUsed;

      if (result.success) {
        currentInput = result.output;
      } else {
        break;
      }
    }

    return {
      success: results.every((r) => r.success),
      mode: 'sequential',
      agentResults: results,
      finalOutput: currentInput,
      totalTokens,
      totalExecutionTime: Date.now() - startTime,
      iterations: 1,
      metadata: { agentCount: agents.length },
    };
  }

  async executeParallel(agents: LLMAgent[], input: string): Promise<LLMAgentCollaborationResult> {
    const startTime = Date.now();

    const promises = agents.map((agent) => this.callAgent(agent, input));
    const settled = await Promise.allSettled(promises);

    const results: LLMAgentResult[] = settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        agentId: agents[i]?.id || '',
        agentName: agents[i]?.name || '',
        output: '',
        tokensUsed: 0,
        executionTime: 0,
        success: false,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    });

    const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);
    const combinedOutput = results
      .filter((r) => r.success)
      .map((r) => `### ${r.agentName}\n${r.output}`)
      .join('\n\n---\n\n');

    return {
      success: results.every((r) => r.success),
      mode: 'parallel',
      agentResults: results,
      finalOutput: combinedOutput,
      totalTokens,
      totalExecutionTime: Date.now() - startTime,
      iterations: 1,
      metadata: { agentCount: agents.length },
    };
  }

  async executeDebate(
    agents: LLMAgent[],
    topic: string,
    maxRounds: number = 3
  ): Promise<LLMAgentCollaborationResult> {
    const startTime = Date.now();
    const results: LLMAgentResult[] = [];
    let totalTokens = 0;
    let debateHistory = '';

    for (let round = 0; round < maxRounds; round++) {
      for (const agent of agents) {
        const prompt = round === 0
          ? `Topic: ${topic}\n\nPresent your initial position and key arguments.`
          : `Topic: ${topic}\n\nRound ${round + 1} of ${maxRounds}\n\nPrevious arguments:\n${debateHistory}\n\nProvide your counter-arguments or supporting evidence.`;

        const result = await this.callAgent(agent, prompt);
        results.push(result);
        totalTokens += result.tokensUsed;

        if (result.success) {
          debateHistory += `[${agent.name}]: ${result.output.substring(0, 1000)}\n\n`;
        }
      }
    }

    const consensusPrompt = `Based on the following debate, provide a balanced consensus summary:\n\n${debateHistory}`;
    const consensusResult = await this.callAgent(
      { id: 'moderator', name: 'Moderator', type: 'moderator', systemPrompt: '你是一个中立的辩论主持人，负责总结各方观点并达成共识。' },
      consensusPrompt,
      4096
    );
    results.push(consensusResult);
    totalTokens += consensusResult.tokensUsed;

    return {
      success: true,
      mode: 'debate',
      agentResults: results,
      finalOutput: consensusResult.output,
      totalTokens,
      totalExecutionTime: Date.now() - startTime,
      iterations: maxRounds,
      metadata: { rounds: maxRounds, agentCount: agents.length },
    };
  }

  async executeHierarchical(
    supervisor: LLMAgent,
    subordinates: LLMAgent[],
    input: string
  ): Promise<LLMAgentCollaborationResult> {
    const startTime = Date.now();
    const results: LLMAgentResult[] = [];
    let totalTokens = 0;

    const supervisorResult = await this.callAgent(
      supervisor,
      `Analyze the following task and break it down into ${subordinates.length} subtasks. For each subtask, specify what the subordinate should do.\n\nTask: ${input}`,
      4096
    );
    results.push(supervisorResult);
    totalTokens += supervisorResult.tokensUsed;

    if (!supervisorResult.success) {
      return {
        success: false,
        mode: 'hierarchical',
        agentResults: results,
        finalOutput: '',
        totalTokens,
        totalExecutionTime: Date.now() - startTime,
        iterations: 1,
        metadata: { agentCount: 1 + subordinates.length },
      };
    }

    const subtaskLines = supervisorResult.output.split('\n').filter((l) => l.trim());
    const subordinateResults: LLMAgentResult[] = [];

    for (let i = 0; i < subordinates.length; i++) {
      const subtask = subtaskLines[i % subtaskLines.length] || `Complete your part of: ${input}`;
      const result = await this.callAgent(subordinates[i]!, `Supervisor assigned task: ${subtask}\n\nOriginal goal: ${input}`);
      subordinateResults.push(result);
      totalTokens += result.tokensUsed;
    }

    results.push(...subordinateResults);

    const synthesisPrompt = `You are a supervisor. Synthesize the following subordinate results into a cohesive final output:\n\n${subordinateResults.map((r) => `[${r.agentName}]: ${r.output.substring(0, 2000)}`).join('\n\n')}`;
    const synthesisResult = await this.callAgent(supervisor, synthesisPrompt, 4096);
    results.push(synthesisResult);
    totalTokens += synthesisResult.tokensUsed;

    return {
      success: synthesisResult.success,
      mode: 'hierarchical',
      agentResults: results,
      finalOutput: synthesisResult.output,
      totalTokens,
      totalExecutionTime: Date.now() - startTime,
      iterations: 1,
      metadata: { agentCount: 1 + subordinates.length },
    };
  }

  async executeExpertTeam(
    experts: Array<LLMAgent & { specialty: string }>,
    input: string
  ): Promise<LLMAgentCollaborationResult> {
    const startTime = Date.now();
    const results: LLMAgentResult[] = [];
    let totalTokens = 0;
    let accumulatedKnowledge = '';

    for (const expert of experts) {
      const prompt = accumulatedKnowledge
        ? `Task: ${input}\n\nPrevious expert contributions:\n${accumulatedKnowledge}\n\nAs a ${expert.specialty} expert, provide your professional contribution.`
        : `Task: ${input}\n\nAs a ${expert.specialty} expert, provide your professional contribution.`;

      const result = await this.callAgent(expert, prompt);
      results.push(result);
      totalTokens += result.tokensUsed;

      if (result.success) {
        accumulatedKnowledge += `[${expert.name} (${expert.specialty})]: ${result.output.substring(0, 2000)}\n\n`;
      }
    }

    const integratorPrompt = `Integrate the following expert contributions into a comprehensive, well-structured output:\n\n${accumulatedKnowledge}`;
    const integratorResult = await this.callAgent(
      { id: 'integrator', name: 'Integrator', type: 'integrator', systemPrompt: '你是一个专业的内容整合专家，负责将多个专家的贡献整合为一份连贯、专业的最终输出。' },
      integratorPrompt,
      4096
    );
    results.push(integratorResult);
    totalTokens += integratorResult.tokensUsed;

    return {
      success: integratorResult.success,
      mode: 'expert_team',
      agentResults: results,
      finalOutput: integratorResult.output,
      totalTokens,
      totalExecutionTime: Date.now() - startTime,
      iterations: 1,
      metadata: { expertCount: experts.length, specialties: experts.map((e) => e.specialty) },
    };
  }

  async executeCriticReviewer(
    creator: LLMAgent,
    critic: LLMAgent,
    input: string,
    maxRounds: number = 2
  ): Promise<LLMAgentCollaborationResult> {
    const startTime = Date.now();
    const results: LLMAgentResult[] = [];
    let totalTokens = 0;
    let currentDraft = '';
    let lastFeedback = '';

    for (let round = 0; round < maxRounds; round++) {
      const creationPrompt = round === 0
        ? input
        : `Improve the following draft based on reviewer feedback:\n\nPrevious draft:\n${currentDraft}\n\nReview feedback:\n${lastFeedback}`;

      const creationResult = await this.callAgent(creator, creationPrompt);
      results.push(creationResult);
      totalTokens += creationResult.tokensUsed;

      if (!creationResult.success) break;
      currentDraft = creationResult.output;

      const reviewPrompt = `Review the following content critically. Identify issues and provide specific improvement suggestions:\n\n${currentDraft}`;
      const reviewResult = await this.callAgent(critic, reviewPrompt);
      results.push(reviewResult);
      totalTokens += reviewResult.tokensUsed;

      if (!reviewResult.success) break;
      lastFeedback = reviewResult.output;

      const approved = /approved|acceptable|well.done|excellent|no.major/i.test(reviewResult.output);
      if (approved) break;
    }

    return {
      success: currentDraft.length > 0,
      mode: 'critic_reviewer',
      agentResults: results,
      finalOutput: currentDraft,
      totalTokens,
      totalExecutionTime: Date.now() - startTime,
      iterations: maxRounds,
      metadata: { reviewRounds: maxRounds },
    };
  }
}
