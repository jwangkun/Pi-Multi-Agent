import { DynamicWorkflow } from '../src/workflow/index.js';

const API_KEY = process.env.DEEPSEEK_API_KEY || '';

async function example1_autoGenerate() {
  console.log('=== Example 1: Auto-generate workflow from natural language ===\n');

  const workflow = new DynamicWorkflow({
    apiKey: API_KEY,
    tokenBudget: 100000,
    maxConcurrentAgents: 3,
  });

  workflow.onEvent((event) => {
    switch (event.type) {
      case 'workflow:started':
        console.log(`🚀 Workflow started: ${event.meta.name}`);
        break;
      case 'phase:changed':
        console.log(`📍 Phase: ${event.phase}`);
        break;
      case 'agent:started':
        console.log(`  ▶ Agent #${event.agentId}: ${event.label}`);
        break;
      case 'agent:completed':
        console.log(`  ✓ Agent #${event.agentId}: ${event.label} done`);
        break;
      case 'agent:failed':
        console.log(`  ✗ Agent #${event.agentId}: ${event.label} failed - ${event.error}`);
        break;
      case 'workflow:log':
        console.log(`  ℹ ${event.message}`);
        break;
    }
  });

  const result = await workflow.run(
    'Analyze the current AI agent market landscape. Identify the top 5 competitors, their key features, and market positioning. Then provide a strategic recommendation for a new entrant.',
    { focus: 'enterprise', region: 'global' }
  );

  console.log('\n' + DynamicWorkflow.renderSnapshot(result.snapshot));
  console.log(`\nTotal tokens: ${result.totalTokens}`);
  console.log(`Execution time: ${result.totalExecutionTime}ms`);
  console.log(`\nOutput preview: ${JSON.stringify(result.output).substring(0, 500)}...`);
}

async function example2_manualScript() {
  console.log('\n=== Example 2: Execute a manually written workflow script ===\n');

  const script = `
export const meta = {
  name: 'code_audit',
  description: 'Audit a codebase for security, style, and performance',
  phases: [
    { title: 'Scan' },
    { title: 'Review' },
    { title: 'Synthesize' },
  ],
}

phase('Scan')
const inventory = await agent('List all source files in this project and categorize them by type (source, test, config, docs). Return a structured list.', {
  label: 'file inventory',
  schema: {
    type: 'object',
    properties: {
      sourceFiles: { type: 'array', items: { type: 'string' } },
      testFiles: { type: 'array', items: { type: 'string' } },
      configFiles: { type: 'array', items: { type: 'string' } },
    },
    required: ['sourceFiles', 'testFiles', 'configFiles'],
  },
})

phase('Review')
const [security, style] = await parallel([
  () => agent('Review these source files for security vulnerabilities: ' + JSON.stringify(inventory.sourceFiles).substring(0, 2000) + '. Focus on injection, auth, and data exposure issues.', {
    label: 'security review',
  }),
  () => agent('Review these source files for code style and best practices: ' + JSON.stringify(inventory.sourceFiles).substring(0, 2000) + '. Focus on naming, structure, and TypeScript patterns.', {
    label: 'style review',
  }),
])

phase('Synthesize')
const report = await agent(
  'Combine the following reviews into a prioritized action report:\\n\\nSecurity:\\n' + security + '\\n\\nStyle:\\n' + style,
  { label: 'final report' },
)

return { inventory, security, style, report }
`;

  const workflow = new DynamicWorkflow({
    apiKey: API_KEY,
    tokenBudget: 150000,
  });

  workflow.onEvent((event) => {
    if (event.type === 'agent:started') {
      console.log(`  ▶ [${event.phase}] ${event.label}`);
    } else if (event.type === 'agent:completed') {
      console.log(`  ✓ Agent #${event.agentId}: ${event.label}`);
    }
  });

  const validation = await workflow.validateScript(script);
  console.log('Script validation:', validation.valid ? '✓ Valid' : `✗ ${validation.error}`);

  if (validation.valid) {
    const result = await workflow.executeScript(script);
    console.log('\n' + DynamicWorkflow.renderSnapshot(result.snapshot));
    console.log(`\nSuccess: ${result.success}`);
    console.log(`Total tokens: ${result.totalTokens}`);
  }
}

async function example3_pipeline() {
  console.log('\n=== Example 3: Pipeline pattern - per-item fan-out ===\n');

  const script = `
export const meta = {
  name: 'multi_topic_research',
  description: 'Research multiple topics in parallel with sequential stages',
  phases: [
    { title: 'Research' },
    { title: 'Summarize' },
  ],
}

const topics = ['LLM Agents', 'RAG Systems', 'AI Safety']

phase('Research')
const researchResults = await pipeline(
  topics,
  async (prev, topic) => {
    return await agent('Provide a comprehensive overview of ' + topic + ' including key concepts, major players, and recent developments.', {
      label: 'research: ' + topic,
    })
  },
)

phase('Summarize')
const summaries = await pipeline(
  researchResults,
  async (prev, research) => {
    return await agent('Create a concise 3-bullet summary from this research:\\n' + research, {
      label: 'summarize',
    })
  },
)

return { topics, researchResults, summaries }
`;

  const workflow = new DynamicWorkflow({
    apiKey: API_KEY,
    tokenBudget: 200000,
    maxConcurrentAgents: 3,
  });

  const result = await workflow.executeScript(script);
  console.log(DynamicWorkflow.renderSnapshot(result.snapshot));
}

async function main() {
  if (!API_KEY) {
    console.error('Please set DEEPSEEK_API_KEY environment variable');
    console.error('Usage: DEEPSEEK_API_KEY=your_key npx tsx examples/dynamic-workflow.ts');
    process.exit(1);
  }

  try {
    await example1_autoGenerate();
  } catch (err) {
    console.error('Example 1 failed:', err);
  }

  try {
    await example2_manualScript();
  } catch (err) {
    console.error('Example 2 failed:', err);
  }

  try {
    await example3_pipeline();
  } catch (err) {
    console.error('Example 3 failed:', err);
  }
}

main().catch(console.error);
