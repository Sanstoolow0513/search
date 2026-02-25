# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Multi-Agent ReAct System** web application built with Next.js 16, React 19, TypeScript, and Tailwind CSS v4. It provides an AI-powered research assistant that uses multiple specialized agents (Planner, Executor, Reviewer) to answer complex questions through iterative web search and reasoning.

## Development Commands

```bash
# Install dependencies
pnpm install

# Start development server (http://localhost:3000)
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Run ESLint
pnpm lint
```

## Environment Variables

Create a `.env.local` file with:

```env
# Required - OpenRouter API for LLM access
OPENROUTER_API_KEY=your_key_here

# Optional - defaults to anthropic/claude-3.5-sonnet
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet

# Required for web search functionality
TAVILY_API_KEY=your_key_here
```

## Architecture

### Multi-Agent Coordination Pattern

The system uses a **coordinator-based multi-agent architecture** where specialized agents collaborate iteratively:

```
User Query
    ↓
Coordinator (runMultiAgentLoop)
    ↓
Plan Agent → Creates search strategy (3-5 queries)
    ↓
Exec Agent → Executes searches, collects information
    ↓
Review Phase → Evaluates quality, scores confidence (0-100)
    ↓
[Confidence < 75%?] → Refine strategy or continue search → Repeat
    ↓
[Confidence ≥ 75%] → Generate final answer
```

**Entry point**: `lib/agent/coordinator.ts` - `runMultiAgentLoop()` is the main async generator that orchestrates the multi-agent workflow.

### Agent Responsibilities

1. **Plan Agent** (`lib/agent/plan-agent.ts`):
   - Analyzes user requests and creates search strategies
   - Defines 3-5 targeted search queries with purposes and expected outcomes
   - Performs review phase: critiques collected information, scores confidence
   - Decides next action: `finalize`, `refine_strategy`, or `continue_search`

2. **Exec Agent** (`lib/agent/exec-agent.ts`):
   - Executes search queries from the strategy
   - Filters out already-executed queries to avoid duplication
   - Collects and organizes search results
   - Tracks successful vs failed searches

3. **Coordinator** (`lib/agent/coordinator.ts`):
   - Orchestrates the multi-agent loop (max 5 iterations by default)
   - Maintains `executedQueries` Set to prevent duplicate searches
   - Accumulates `allCollectedInfo` across iterations
   - Routes based on review decision:
     - `refine_strategy`: Appends new queries to existing strategy
     - `continue_search`: Replaces strategy with additional queries

### Project Structure

```
app/
├── api/agent/route.ts      # API endpoint that streams agent responses via SSE
├── layout.tsx              # Root layout with Geist font
├── page.tsx                # Main page
├── globals.css             # Tailwind v4 CSS with dark theme
components/
├── agent-chat.tsx          # Main chat UI with multi-panel reasoning display
lib/
├── agent/
│   ├── coordinator.ts      # Multi-agent orchestration (main entry point)
│   ├── plan-agent.ts       # Planning & review agent
│   ├── exec-agent.ts       # Execution agent
│   ├── reactor.ts          # Legacy single ReAct loop (unused)
│   ├── types.ts            # TypeScript interfaces
│   ├── utils.ts            # File tree utilities
│   ├── index.ts            # Public exports
│   └── prompts/            # LLM system prompts
│       ├── plan-prompt.ts
│       ├── exec-prompt.ts
│       ├── review-prompt.ts
│       └── index.ts
├── llm/
│   ├── index.ts            # OpenRouter API client
│   └── prompts.ts          # System prompt builder
├── tools/
│   ├── index.ts            # Tool registry and executeTool()
│   ├── read.ts             # File read tool (project dir only)
│   ├── write.ts            # File write tool (project dir only)
│   └── web-search.ts       # Tavily web search with deduplication
└── config.ts               # Configuration for APIs
```

### Streaming Architecture

The agent uses Server-Sent Events (SSE) for real-time updates:

1. Client POSTs to `/api/agent` with message
2. Server creates a ReadableStream that yields `MultiAgentStreamEvent`
3. Client reads stream and updates UI in real-time
4. Event types:
   - `phase`: Current phase indicator (Planning, Execution, Review)
   - `plan_thought`: Plan Agent's strategy or reasoning
   - `exec_action`: Exec Agent's search execution status
   - `review`: Review Phase confidence score and critique
   - `final_answer`: Synthesized final answer
   - `error`: Error messages

### Tool System

Three built-in tools in `lib/tools/`:

- **read**: Reads files within project directory (path traversal protected, 1MB limit)
- **write**: Writes files within project directory (auto-creates directories)
- **web_search**: Tavily API integration with Jaccard similarity deduplication (>80% similarity blocked)

New tools must implement the `Tool` interface in `lib/tools/types.ts` and be registered in `lib/tools/index.ts`.

### Key TypeScript Interfaces

```typescript
// lib/agent/types.ts
interface SearchStrategy {
  queries: SearchQuery[]        // Query + purpose + expected info
  informationGaps: string[]
  confidenceLevel: 'high' | 'medium' | 'low'
}

interface ReviewResult {
  confidenceScore: number       // 0-100
  nextAction: 'finalize' | 'refine_strategy' | 'continue_search'
  additionalQueries?: string[]  // For refine/continue actions
}

interface CoordinationState {
  planSteps: AgentStep[]        // Plan agent activity log
  execSteps: AgentStep[]        // Exec agent activity log
  currentStrategy?: SearchStrategy
  iterationCount: number        // Current iteration (max 5)
}
```

### Security Considerations

- File tools restrict access to project directory only (path traversal check via `resolve()` comparison)
- Max file size limit (1MB) for read operations
- Environment variables required for external APIs (OpenRouter, Tavily)
- Search deduplication prevents redundant API calls
