import { LLMAgentCollaboration } from '../src/collaboration/llm-collaboration.js';

const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  console.error('Error: DEEPSEEK_API_KEY environment variable is required');
  process.exit(1);
}

const agents = [
  {
    id: 'researcher',
    name: 'Market Researcher',
    type: 'researcher',
    systemPrompt: 'You are a senior market researcher specializing in technology industry analysis. Provide data-driven insights with specific numbers and sources.',
  },
  {
    id: 'analyst',
    name: 'Data Analyst',
    type: 'analyst',
    systemPrompt: 'You are a quantitative data analyst. Focus on market sizing, growth rates, and competitive metrics. Always support claims with data.',
  },
  {
    id: 'writer',
    name: 'Report Writer',
    type: 'writer',
    systemPrompt: 'You are a professional business report writer. Synthesize research and analysis into clear, well-structured reports with executive summaries.',
  },
];

async function main() {
  const collaboration = new LLMAgentCollaboration(API_KEY);
  const task = 'Analyze the current AI Agent market landscape and provide strategic recommendations';

  console.log('Pi Multi-Agent - Collaboration Modes Example\n');

  console.log('1. Sequential Handoffs\n');
  const seqResult = await collaboration.executeSequential(agents, task);
  console.log(`   Success: ${seqResult.success}`);
  console.log(`   Tokens: ${seqResult.totalTokens}`);
  console.log(`   Output: ${seqResult.finalOutput.substring(0, 200)}...\n`);

  console.log('2. Parallel Processing\n');
  const parResult = await collaboration.executeParallel(agents, task);
  console.log(`   Success: ${parResult.success}`);
  console.log(`   Tokens: ${parResult.totalTokens}`);
  console.log(`   Agents completed: ${parResult.agentResults.filter((r) => r.success).length}\n`);

  console.log('3. Expert Team\n');
  const expertResult = await collaboration.executeExpertTeam(
    agents.map((a) => ({ ...a, specialty: a.type })),
    task
  );
  console.log(`   Success: ${expertResult.success}`);
  console.log(`   Tokens: ${expertResult.totalTokens}\n`);

  console.log('4. Hierarchical\n');
  const hierResult = await collaboration.executeHierarchical(agents[0]!, agents.slice(1), task);
  console.log(`   Success: ${hierResult.success}`);
  console.log(`   Tokens: ${hierResult.totalTokens}\n`);

  console.log('5. Critic-Reviewer\n');
  const criticResult = await collaboration.executeCriticReviewer(agents[0]!, agents[1]!, task, 2);
  console.log(`   Success: ${criticResult.success}`);
  console.log(`   Iterations: ${criticResult.iterations}\n`);

  console.log('6. Debate & Consensus\n');
  const debateResult = await collaboration.executeDebate(agents, task, 2);
  console.log(`   Success: ${debateResult.success}`);
  console.log(`   Rounds: ${debateResult.iterations}\n`);

  console.log('All collaboration modes completed.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
