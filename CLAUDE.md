# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Multi-Agent ReAct System** web application built with Next.js 16, React 19, TypeScript, and Tailwind CSS v4. It provides an AI-powered research assistant that uses multiple specialized agents (Planner, Executor, Reviewer) to answer complex questions through iterative web search and reasoning.

## Development Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start development server (http://localhost:3000)
pnpm build            # Build for production
pnpm start            # Start production server
pnpm lint             # Run ESLint
pnpm tsc --noEmit     # Type check without emitting
```

## Environment Variables

Create a `.env.local` file with:

```env
OPENROUTER_API_KEY=your_key_here     # Required - OpenRouter API for LLM access
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet  # Optional - defaults to this
TAVILY_API_KEY=your_key_here         # Required for web search
```

## Architecture

### Function Calling Architecture

The system uses **OpenAI-compatible Function Calling** for structured LLM interactions:

```
All Agents → LLM + Tools → tool_calls[] → executeToolCall() → Observations → Loop/Complete
```

Key components:
- `lib/llm/index.ts`: `callLLM()` accepts `tools` and `toolChoice` parameters, returns `LLMResponse` with `toolCalls`
- `lib/tools/index.ts`: `toOpenAITools()` converts tools to OpenAI format; `executeToolCall()` executes parsed calls
- `lib/agent/types.ts`: `OpenAITool`, `ParsedToolCall`, `ChatMessage` (supports `tool` role)

### Multi-Agent Coordination Pattern

```
User Query → Coordinator (runMultiAgentLoop)
         → Plan Agent (create_search_strategy tool) → Search queries
         → Exec Agent (web_search/read/write tools) → Collected info
         → Review Phase (submit_review tool) → Confidence score 0-100
         → [Confidence < 75%?] → Refine/continue → Repeat
         → [Confidence ≥ 75%] → Final answer
```

**Entry point**: `lib/agent/coordinator.ts` - `runMultiAgentLoop()` orchestrates the workflow with max 5 iterations.

### Agent Tool Bindings

1. **Plan Agent** (`lib/agent/plan-agent.ts`):
   - Uses `create_search_strategy` tool (forced via `toolChoice`)
   - Uses `submit_review` tool for review phase
   - Returns structured `SearchStrategy` and `ReviewResult`

2. **Exec Agent** (`lib/agent/exec-agent.ts`):
   - Multi-turn tool calling loop (max 20 iterations)
   - Dynamically selects from `web_search`, `read`, `write` tools
   - Accumulates `collectedInfo` from tool results

3. **Coordinator** (`lib/agent/coordinator.ts`):
   - Routes based on `nextAction`: `finalize`, `refine_strategy`, `continue_search`
   - Maintains `executedQueries` Set to prevent duplicate searches

### Key Types (`lib/agent/types.ts`)

```typescript
OpenAITool          // Tool definition for function calling
ParsedToolCall      // { id, name, arguments } from LLM response
ChatMessage         // Supports 'tool' role with tool_calls/tool_call_id
LLMResponse         // { content, toolCalls, finishReason }
SearchStrategy      // { queries, informationGaps, confidenceLevel }
ReviewResult        // { confidenceScore, nextAction, additionalQueries }
```

### Project Structure

```
lib/
├── agent/
│   ├── coordinator.ts    # Multi-agent orchestration (main entry)
│   ├── plan-agent.ts     # Planning & review with function calling
│   ├── exec-agent.ts     # Multi-turn tool execution loop
│   ├── types.ts          # All TypeScript interfaces
│   └── prompts/          # LLM system prompts
├── llm/
│   └── index.ts          # OpenRouter client with function calling
└── tools/
    ├── index.ts          # Tool registry, toOpenAITools(), executeToolCall()
    ├── web-search.ts     # Tavily API with deduplication
    ├── read.ts           # File read (project dir only)
    └── write.ts          # File write (project dir only)
```

### Streaming Architecture

Server-Sent Events (SSE) via `/api/agent`:
- Event types: `phase`, `plan_thought`, `exec_action`, `review`, `final_answer`, `error`
- Client reads stream and updates UI in real-time

### Security Considerations

- File tools restrict access to project directory only (path traversal check via `resolve()`)
- Max file size limit (1MB) for read operations
- Search deduplication (>80% Jaccard similarity) prevents redundant API calls
- Environment variables for external APIs (never commit keys)