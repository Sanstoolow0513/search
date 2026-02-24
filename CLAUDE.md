# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **ReAct Agent** web application built with Next.js 16, React 19, TypeScript, and Tailwind CSS v4. It provides an AI-powered chat interface that can reason through tasks, use tools (web search, file read/write), and provide detailed answers with visible reasoning steps.

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

### ReAct Agent Pattern

The core architecture follows the ReAct (Reasoning + Acting) pattern:

1. **Thought**: Agent reasons about the task
2. **Action**: Agent selects a tool and provides input
3. **Observation**: Tool executes and returns result
4. **Loop**: Continues until the agent outputs a Final Answer

Entry point: `lib/agent/reactor.ts` - `runReActLoop()` is the main async generator that orchestrates the reasoning loop.

### Project Structure

```
app/
├── api/agent/route.ts      # API endpoint that streams agent responses via SSE
├── layout.tsx              # Root layout with Geist font
├── page.tsx                # Main page (currently default Next.js template)
├── globals.css             # Tailwind v4 CSS with dark theme
components/
├── agent-chat.tsx          # Main chat UI component with reasoning panel
lib/
├── agent/
│   ├── reactor.ts          # Core ReAct loop implementation
│   ├── types.ts            # TypeScript interfaces (Tool, ReActStep, AgentState)
│   └── index.ts            # Public exports
├── llm/
│   ├── index.ts            # OpenRouter API client
│   └── prompts.ts          # System prompt builder with tool descriptions
├── tools/
│   ├── index.ts            # Tool registry and executeTool() function
│   ├── read.ts             # File read tool
│   ├── write.ts            # File write tool (restricted to project dir)
│   └── web-search.ts       # Tavily web search with deduplication
└── config.ts               # Configuration for APIs and project settings
```

### Key Components

**Agent Chat UI** (`components/agent-chat.tsx`):
- Client-side component with conversation management
- Streams events from `/api/agent` endpoint
- Displays reasoning steps in a side panel
- Supports multiple conversations with sidebar navigation

**Tool System** (`lib/tools/`):
- Three built-in tools: `read`, `write`, `web_search`
- Each tool implements the `Tool` interface with JSON schema parameters
- New tools must be registered in `lib/tools/index.ts`

**LLM Integration** (`lib/llm/index.ts`):
- Uses OpenRouter API with configurable model
- Supports both streaming and non-streaming responses
- Referer and title headers identify the app to OpenRouter

### Streaming Architecture

The agent uses Server-Sent Events (SSE) for real-time updates:

1. Client POSTs to `/api/agent` with message
2. Server creates a ReadableStream that yields ReAct steps
3. Client reads stream and updates UI in real-time
4. Event types: `thought`, `action`, `observation`, `final_answer`, `error`

### Search Deduplication

The web search tool includes similarity-based deduplication to prevent redundant searches. Search history is cleared at the start of each new conversation (`clearSearchHistory()` in `reactor.ts`).

### Security Considerations

- File tools restrict access to project directory only (path traversal check)
- Max file size limit (1MB) for read operations
- Environment variables required for external APIs
