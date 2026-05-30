# π Multi-Agent

**Production-Grade Multi-Agent Orchestration Framework**

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-3178C6.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg)](https://nodejs.org/)
[![npm](https://img.shields.io/npm/v/pi-multi-agent.svg)](https://www.npmjs.com/package/pi-multi-agent)
[![GitHub stars](https://img.shields.io/github/stars/pi-multi-agent/pi-multi-agent?style=flat)](https://github.com/pi-multi-agent/pi-multi-agent/stargazers)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Features](#features) · [Quick Start](#quick-start) · [Architecture](#architecture) · [Collaboration Patterns](#6-collaboration-patterns) · [API Reference](#api-reference) · [Web Dashboard](#web-dashboard) · [Contributing](#contributing)

---

![alt text](demo.png) ![alt text](demo1.png)

## Overview

π Multi-Agent is a TypeScript framework for building production-grade multi-agent systems. It provides **6 collaboration patterns**, **6 communication structures**, **LLM-powered deep planning**, **agent cluster execution with real tool calling**, and a **real-time web dashboard**.

Unlike simple prompt-chaining libraries, π Multi-Agent implements the full agent lifecycle: **Goal → Plan → Execute → Evaluate → Replan → Output**, with real LLM function calling, inter-agent memory sharing, and iterative quality improvement.

## Screenshots

<table align="center">
  <tr>
    <td><img src="demo.png" alt="Pi Multi-Agent Dashboard" width="400" /></td>
    <td><img src="demo1.png" alt="Pi Multi-Agent Deep Research" width="400" /></td>
  </tr>
</table>

## Features

- **6 Collaboration Patterns** — Sequential, Parallel, Debate & Consensus, Expert Team, Critic-Reviewer, Hierarchical
- **6 Communication Structures** — Single Agent, Network, Supervisor, Supervisor as Tool, Hierarchical, Custom
- **LLM-Powered Deep Planning** — Intelligent task decomposition with dependency graphs and quality thresholds
- **Agent Cluster Execution** — 10+ sub-agents with real tool calling (web search, data analysis, code execution)
- **Iterative Quality Loop** — Multi-dimensional evaluation → replan → retry until quality threshold met
- **Enhanced Shared Memory** — Inter-agent data passing, session context, output sharing
- **Real-Time Dashboard** — WebSocket-powered UI with agent status, tool calls, progress tracking
- **Type-Safe** — Full TypeScript with strict mode, zero `any` escapes in public API

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         π Multi-Agent                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Deep Planner │  │   Agent      │  │    Deep Evaluator        │  │
│  │ LLM-Driven   │  │  Cluster     │  │  4-Dimension Assessment  │  │
│  │ Task Decomp. │  │  Execution   │  │  + Reflection + Replan   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                  Enhanced Shared Memory                      │   │
│  │  ┌────────────┐  ┌────────────┐  ┌──────────────────────┐   │   │
│  │  │  Agent      │  │  Session   │  │   Inter-Agent        │   │   │
│  │  │  Outputs    │  │  Context   │  │   Messaging          │   │   │
│  │  └────────────┘  └────────────┘  └──────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   6 Collaboration Patterns                   │   │
│  │  Sequential │ Parallel │ Debate │ Expert │ Critic │ Hier.   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   Tool System (Function Calling)              │   │
│  │  web_search │ data_analyzer │ web_scraper │ code_executor    │   │
│  │  report_writer │ knowledge_base │ calculator │ agent_delegate│   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   6 Communication Structures                  │   │
│  │  Single │ Network │ Supervisor │ AsTool │ Hier. │ Custom     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 8-Step Execution Lifecycle

```
[User Goal] → 1. Goal Definition
             → 2. Deep Planner (LLM-driven task decomposition)
             → 3. Agent Cluster (spawn 10+ specialized agents)
             → 4. Tool Calling (web search, data analysis, etc.)
             → 5. Shared Memory (inter-agent data passing)
             → 6. Deep Evaluator (4-dimension quality assessment)
             → 7. Replan/Retry (if quality < threshold)
             → 8. Final Output (synthesized report)
```

## Quick Start

### Installation

```bash
npm install pi-multi-agent
```

### Prerequisites

- Node.js 18+
- A DeepSeek API key (or OpenAI-compatible endpoint)

### 1. Deep Research (Agent Cluster)

```typescript
import { DeepPlanner, AgentCluster } from 'pi-multi-agent';

const planner = new DeepPlanner(process.env.DEEPSEEK_API_KEY);
const plan = await planner.createDeepPlan(
  'Complete a comprehensive AI Agent market research report',
  { targetWordCount: 30000, maxAgents: 8 }
);

const cluster = new AgentCluster(process.env.DEEPSEEK_API_KEY, 'session-1');

cluster.onEvent((event) => {
  console.log(`[${event.type}] ${event.agentName}:`, event.data);
});

const result = await cluster.executePlan(plan, 3);
console.log(`Report: ${result.finalOutput.length} chars, Score: ${result.evaluationScore}`);
```

### 2. Collaboration Modes

```typescript
import { LLMAgentCollaboration } from 'pi-multi-agent';

const collab = new LLMAgentCollaboration(process.env.DEEPSEEK_API_KEY);

const agents = [
  { id: 'researcher', name: 'Researcher', type: 'researcher',
    systemPrompt: 'You are a market research expert.' },
  { id: 'analyst', name: 'Analyst', type: 'analyst',
    systemPrompt: 'You are a data analysis expert.' },
  { id: 'writer', name: 'Writer', type: 'writer',
    systemPrompt: 'You are a professional report writer.' },
];

// Sequential: Researcher → Analyst → Writer
const seqResult = await collab.executeSequential(agents, 'Analyze AI market trends');

// Parallel: All agents work simultaneously
const parResult = await collab.executeParallel(agents, 'Multi-perspective analysis');

// Expert Team: Domain specialists + integrator
const expResult = await collab.executeExpertTeam(
  agents.map(a => ({ ...a, specialty: a.type })),
  'Comprehensive report'
);

// Debate: Multi-round discussion for consensus
const debResult = await collab.executeDebate(agents, 'Investment strategy', 3);

// Hierarchical: Supervisor → Subordinates → Synthesize
const hierResult = await collab.executeHierarchical(agents[0], agents.slice(1), task);

// Critic-Reviewer: Create → Review → Iterate
const critResult = await collab.executeCriticReviewer(agents[0], agents[1], task, 2);
```

### 3. Core Agent API

```typescript
import { Agent, SequentialHandoffs, AgentContext } from 'pi-multi-agent';

const researcher = new Agent({
  name: 'Researcher',
  systemPrompt: 'You are a research expert.',
  model: { provider: 'openai', model: 'gpt-4' },
}, myExecutor);

const analyst = new Agent({
  name: 'Analyst',
  systemPrompt: 'You are a data analyst.',
  model: { provider: 'openai', model: 'gpt-4' },
}, myExecutor);

const workflow = new SequentialHandoffs([researcher, analyst], context);
const result = await workflow.execute('Research AI trends and analyze findings');
```

## 6 Collaboration Patterns

| Pattern | Description | Best For |
|---------|-------------|----------|
| **Sequential Handoffs** | Pipeline: Agent A → B → C | Structured workflows with clear stages |
| **Parallel Processing** | All agents work simultaneously | Independent multi-perspective tasks |
| **Debate & Consensus** | Multi-round discussion + moderator | Decision-making, strategy, consensus |
| **Expert Team** | Domain specialists + integrator | Complex multi-domain tasks |
| **Critic-Reviewer** | Create → Review → Iterate | Quality-critical content generation |
| **Hierarchical** | Supervisor → Subordinates → Synthesize | Large-scale task decomposition |

## 6 Communication Structures

| Structure | Description |
|-----------|-------------|
| **Single Agent** | Standalone execution, no inter-agent communication |
| **Network** | Decentralized peer-to-peer topology |
| **Supervisor** | Centralized management with task distribution |
| **Supervisor as Tool** | Advisory pattern, agents consult supervisor |
| **Hierarchical** | Multi-level management tree |
| **Custom** | User-defined topology and routing |

## Tool System

Agents can call real tools via LLM function calling:

| Tool | Description |
|------|-------------|
| `web_search` | Search the internet for information (DuckDuckGo API) |
| `data_analyzer` | Analyze data and generate statistical insights |
| `web_scraper` | Extract content from web pages |
| `code_executor` | Execute code snippets and return results |
| `report_writer` | Structure and format report content |
| `knowledge_base` | Query and retrieve from knowledge base |
| `calculator` | Perform mathematical calculations |
| `agent_delegate` | Delegate subtasks to other agents (Agent-as-Tool) |

Tools are automatically assigned based on agent type:

```typescript
// Researcher agents get: web_search, web_scraper, knowledge_base
// Analyst agents get: data_analyzer, calculator, knowledge_base
// Writer agents get: report_writer
// Coder agents get: code_executor, web_scraper
```

## Deep Evaluator

The evaluator assesses output across 4 dimensions:

1. **Accuracy** — Factual correctness and data validity
2. **Completeness** — Coverage of required topics and depth
3. **Consistency** — Logical coherence and internal consistency
4. **Format** — Structure, readability, and professional formatting

If the evaluation score falls below the threshold, the system automatically replans and retries.

## Web Dashboard

The included Next.js dashboard provides real-time visualization:

```bash
# Terminal 1: Start the backend server
DEEPSEEK_API_KEY=your-key npm run server

# Terminal 2: Start the web dashboard
cd web && npm run dev
```

Features:

- **Agent Cluster Panel** — View all agents, their status, and progress
- **Real-Time Chat** — Submit tasks and see agent responses live
- **Plan Visualization** — Inspect the deep plan and subtask breakdown
- **Tool Call Tracking** — See every tool call with input/output/duration
- **Evaluation Dashboard** — Quality scores with dimension breakdown
- **Report Viewer** — Read and download the final output (Markdown / HTML / TXT)

## Project Structure

```
pi-multi-agent/
├── src/
│   ├── core/                    # Agent base, types, errors
│   │   ├── agent.ts             # Agent lifecycle & execution
│   │   ├── types.ts             # TypeScript type definitions
│   │   ├── errors.ts            # Custom error hierarchy
│   │   └── message.ts           # Message types
│   ├── orchestration/           # Planning, execution, evaluation
│   │   ├── deep-planner.ts      # LLM-driven task decomposition
│   │   ├── agent-cluster.ts     # Cluster execution engine
│   │   ├── deep-evaluator.ts    # 4-dimension quality assessment
│   │   ├── orchestrator.ts      # Task scheduling
│   │   ├── planner.ts           # Basic planning
│   │   └── evaluator.ts         # Basic evaluation
│   ├── collaboration/           # 6 collaboration patterns
│   │   ├── patterns.ts          # Core pattern implementations
│   │   └── llm-collaboration.ts # LLM-powered collaboration
│   ├── communication/           # 6 communication structures
│   │   └── structures.ts        # Topology implementations
│   ├── memory/                  # Memory management
│   │   ├── memory.ts            # Short-term + long-term memory
│   │   └── enhanced-shared-memory.ts  # Inter-agent shared memory
│   └── tools/                   # Tool system
│       ├── index.ts             # 7 core tools + agent-as-tool
│       └── agent-as-tool.ts     # Agent delegation tool
├── server/                      # Backend API server
│   └── index.ts                 # Express + WebSocket server
├── web/                         # Next.js dashboard
│   └── src/app/page.tsx         # Real-time dashboard UI
├── examples/                    # Usage examples
│   ├── deep-research.ts         # Deep research example
│   └── collaboration-modes.ts   # All 6 collaboration modes
└── package.json
```

## API Reference

### DeepPlanner

```typescript
const planner = new DeepPlanner(apiKey, baseURL?);
const plan = await planner.createDeepPlan(goal, options?);
// options: { targetWordCount?: number, maxAgents?: number, depth?: number }
```

### AgentCluster

```typescript
const cluster = new AgentCluster(apiKey, sessionId, baseURL?);
cluster.onEvent(callback);  // Subscribe to events
const result = await cluster.executePlan(plan, maxIterations?);
```

### LLMAgentCollaboration

```typescript
const collab = new LLMAgentCollaboration(apiKey, baseURL?);
await collab.executeSequential(agents, task);
await collab.executeParallel(agents, task);
await collab.executeDebate(agents, topic, maxRounds?);
await collab.executeHierarchical(supervisor, subordinates, task);
await collab.executeExpertTeam(experts, task);
await collab.executeCriticReviewer(creator, critic, task, maxRounds?);
```

### EnhancedSharedMemory

```typescript
const memory = new EnhancedSharedMemory(sessionId);
memory.setGoal(goal);
memory.registerAgent(agentId, name, type);
memory.storeAgentOutput(taskId, output);
memory.sendMessage({ fromAgentId, toAgentId, type, content });
const context = memory.buildContextForAgent(agentId);
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DEEPSEEK_API_KEY` | Yes | DeepSeek API key for LLM calls |
| `PORT` | No | Server port (default: 3001) |

## Development

```bash
# Install dependencies
npm install

# Build the framework
npm run build

# Run type checking
npm run typecheck

# Run tests
npm run test

# Start development watch mode
npm run dev
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on:
- Development setup
- Pull request process
- Coding standards
- Testing guidelines

## Community

Join our community and stay connected:

- **B 站 (Bilibili)** — AI 技术深度解析与实战教程
- **视频号 (WeChat Video)** — AI 前沿动态与产品评测
- **公众号 (WeChat Official Account)** — AI 技术文章与行业洞察
- **YouTube** — AI tutorials and open-source project walkthroughs

## Code of Conduct

This project adheres to a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Acknowledgments

- Built with [TypeScript](https://www.typescriptlang.org/)
- Powered by [DeepSeek](https://www.deepseek.com/) and OpenAI-compatible LLMs
- Dashboard built with [Next.js](https://nextjs.org/)
- Community support from 鲲鹏 Talk

---

**π Multi-Agent** is an open-source project by **鲲鹏 Talk**.

鲲鹏 Talk is a tech community focused on AI, sharing cutting-edge insights, tutorials, and open-source projects across multiple platforms.

## License

[MIT](LICENSE) © Pi Multi-Agent Contributors
