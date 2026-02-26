import { callLLM } from '../llm'
import { toOpenAITools, executeToolCall } from '../tools'
import { buildExecSystemPrompt } from './prompts'
import {
  SearchStrategy,
  ExecAgentResult,
  AgentStep,
  AgentType,
  ChatMessage,
} from './types'
import { logDebug } from '../utils/logger'

const MAX_TOOL_ITERATIONS = 20

export async function runExecAgent(
  strategy: SearchStrategy,
  executedQueries: Set<string> = new Set()
): Promise<{ result: ExecAgentResult; steps: AgentStep[]; newlyExecuted: string[] }> {
  const systemPrompt = buildExecSystemPrompt()
  const tools = toOpenAITools()

  const steps: AgentStep[] = []
  const result: ExecAgentResult = {
    collectedInfo: '',
    queriesExecuted: [],
    successfulSearches: 0,
  }
  const newlyExecuted: string[] = []

  // Filter out already executed queries
  const pendingQueries = strategy.queries.filter(q => !executedQueries.has(q.query))

  // Debug: Log pending queries
  await logDebug('ExecAgent', 'Total strategy queries', strategy.queries.length)
  await logDebug('ExecAgent', 'Executed queries', Array.from(executedQueries))
  await logDebug('ExecAgent', 'Pending queries count', pendingQueries.length)
  await logDebug('ExecAgent', 'Pending queries', pendingQueries.map(q => q.query))

  if (pendingQueries.length === 0) {
    await logDebug('ExecAgent', 'No pending queries to execute')
    return { result, steps, newlyExecuted }
  }

  // Build initial message with search tasks
  const searchTasks = pendingQueries.map((q, i) =>
    `${i + 1}. Query: "${q.query}"\n   Purpose: ${q.purpose}\n   Expected: ${q.expectedInfo}`
  ).join('\n\n')

  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: `Execute the following search strategy. Use the web_search tool for each query. After each search, analyze the results.\n\nSearch Tasks:\n${searchTasks}`,
    },
  ]

  let iterations = 0
  const plannedQuerySet = new Set(pendingQueries.map(q => q.query))
  const completedPlannedQueries = new Set<string>()

  const getNextPendingQuery = (): string | null => {
    const next = pendingQueries.find(q => !completedPlannedQueries.has(q.query))
    return next?.query ?? null
  }

  const recordSearchResult = (query: string, content: string, isError: boolean): boolean => {
    result.queriesExecuted.push(query)
    newlyExecuted.push(query)

    const isNewlyCompletedPlannedQuery = plannedQuerySet.has(query) && !completedPlannedQueries.has(query)
    if (isNewlyCompletedPlannedQuery) {
      completedPlannedQueries.add(query)
    }

    if (!isError) {
      result.successfulSearches++
      result.collectedInfo += `\n\n[From search: "${query}"]\n${content}`
    }

    return isNewlyCompletedPlannedQuery
  }

  const runFallbackSearch = async (query: string, reason: string): Promise<void> => {
    const fallbackCallId = `fallback_${reason}_${iterations}_${completedPlannedQueries.size}`
    const fallbackArguments = { query }

    await logDebug('ExecAgent', 'Running fallback search', { reason, query })

    steps.push({
      agentType: AgentType.EXEC,
      stepType: 'action',
      content: `Fallback ${reason}: Calling web_search(${JSON.stringify(fallbackArguments)})`,
      timestamp: Date.now(),
    })

    messages.push({
      role: 'assistant',
      content: `Fallback ${reason}: executing planned query "${query}".`,
      tool_calls: [{
        id: fallbackCallId,
        type: 'function' as const,
        function: {
          name: 'web_search',
          arguments: JSON.stringify(fallbackArguments),
        },
      }],
    })

    const toolResult = await executeToolCall({
      id: fallbackCallId,
      name: 'web_search',
      arguments: fallbackArguments,
    })

    steps.push({
      agentType: AgentType.EXEC,
      stepType: 'observation',
      content: toolResult.content,
      timestamp: Date.now(),
    })

    messages.push({
      role: 'tool',
      tool_call_id: fallbackCallId,
      name: 'web_search',
      content: toolResult.content,
    })

    recordSearchResult(query, toolResult.content, toolResult.isError)
  }

  while (iterations < MAX_TOOL_ITERATIONS && completedPlannedQueries.size < pendingQueries.length) {
    iterations++

    let llmResult
    try {
      llmResult = await callLLM({
        systemPrompt,
        messages,
        tools,
        toolChoice: 'auto',
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await logDebug('ExecAgent', 'LLM call failed in iteration', {
        iteration: iterations,
        error: errorMessage,
      })

      steps.push({
        agentType: AgentType.EXEC,
        stepType: 'observation',
        content: `LLM call failed (iteration ${iterations}): ${errorMessage}`,
        timestamp: Date.now(),
      })

      const nextPendingQuery = getNextPendingQuery()
      if (!nextPendingQuery) {
        break
      }

      await runFallbackSearch(nextPendingQuery, 'llm_error')
      continue
    }

    // If LLM has text response, record it as thought
    if (llmResult.content) {
      steps.push({
        agentType: AgentType.EXEC,
        stepType: 'thought',
        content: llmResult.content,
        timestamp: Date.now(),
      })
    }

    // If no tool calls, force the next pending planned query instead of stopping early
    if (llmResult.toolCalls.length === 0) {
      await logDebug('ExecAgent', 'No tool calls returned', {
        iteration: iterations,
        remainingPlannedQueries: pendingQueries.length - completedPlannedQueries.size,
      })

      const nextPendingQuery = getNextPendingQuery()
      if (!nextPendingQuery) {
        break
      }

      await runFallbackSearch(nextPendingQuery, 'no_tool_calls')
      continue
    }

    // Record assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: llmResult.content,
      tool_calls: llmResult.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    })

    // Execute each tool call
    let plannedQueryCompletedThisIteration = false
    for (const tc of llmResult.toolCalls) {
      const timestamp = Date.now()

      steps.push({
        agentType: AgentType.EXEC,
        stepType: 'action',
        content: `Calling ${tc.name}(${JSON.stringify(tc.arguments)})`,
        timestamp,
      })

      const toolResult = await executeToolCall(tc)

      steps.push({
        agentType: AgentType.EXEC,
        stepType: 'observation',
        content: toolResult.content,
        timestamp: Date.now(),
      })

      // Add tool result to messages
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.name,
        content: toolResult.content,
      })

      // Track web_search queries
      if (tc.name === 'web_search' && tc.arguments.query) {
        const query = tc.arguments.query as string
        const didCompletePlannedQuery = recordSearchResult(query, toolResult.content, toolResult.isError)
        plannedQueryCompletedThisIteration = plannedQueryCompletedThisIteration || didCompletePlannedQuery
      }
    }

    // Ensure each iteration makes progress on the planned queries
    if (!plannedQueryCompletedThisIteration) {
      const nextPendingQuery = getNextPendingQuery()
      if (nextPendingQuery) {
        await runFallbackSearch(nextPendingQuery, 'no_planned_progress')
      }
    }
  }

  // Log summary
  await logDebug('ExecAgent', 'Execution complete', {
    iterations,
    queriesExecuted: result.queriesExecuted.length,
    plannedQueriesCompleted: completedPlannedQueries.size,
    totalPlannedQueries: pendingQueries.length,
    successfulSearches: result.successfulSearches,
  })

  return { result, steps, newlyExecuted }
}
