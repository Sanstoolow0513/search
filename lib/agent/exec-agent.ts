import { callLLM } from '../llm'
import { executeTool } from '../tools'
import { buildExecSystemPrompt } from './prompts'
import { SearchStrategy, ExecAgentResult, AgentStep, AgentType } from './types'
import { logDebug } from '../utils/logger'

export async function runExecAgent(
  strategy: SearchStrategy,
  executedQueries: Set<string> = new Set()
): Promise<{ result: ExecAgentResult; steps: AgentStep[]; newlyExecuted: string[] }> {
  const systemPrompt = buildExecSystemPrompt()
  const steps: AgentStep[] = []
  const result: ExecAgentResult = {
    collectedInfo: '',
    queriesExecuted: [],
    successfulSearches: 0,
  }
  const newlyExecuted: string[] = []

  const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []

  // Filter out already executed queries
  const pendingQueries = strategy.queries.filter(q => !executedQueries.has(q.query))

  // Debug: Log pending queries
  await logDebug('ExecAgent', 'Total strategy queries', strategy.queries.length)
  await logDebug('ExecAgent', 'Executed queries', Array.from(executedQueries))
  await logDebug('ExecAgent', 'Pending queries count', pendingQueries.length)
  await logDebug('ExecAgent', 'Pending queries', pendingQueries.map(q => q.query))

  for (const searchTask of pendingQueries) {
    const timestamp = Date.now()

    conversationHistory.push({
      role: 'user',
      content: `Execute search query: "${searchTask.query}"`,
    })

    try {
      const llmResponse = await callLLM(systemPrompt, conversationHistory)

      conversationHistory.push({
        role: 'assistant',
        content: llmResponse,
      })

      steps.push({
        agentType: AgentType.EXEC,
        stepType: 'thought',
        content: `Executing search: "${searchTask.query}"`,
        timestamp,
      })

      const observation = await executeTool('web_search', {
        query: searchTask.query,
      })

      steps.push({
        agentType: AgentType.EXEC,
        stepType: 'observation',
        content: observation,
        timestamp: Date.now(),
      })

      result.queriesExecuted.push(searchTask.query)
      newlyExecuted.push(searchTask.query)
      result.successfulSearches++
      result.collectedInfo += `\n\n[From search: "${searchTask.query}"]\n${observation}`

      conversationHistory.push({
        role: 'user',
        content: `Observation: ${observation}\n\nSearch purpose was: ${searchTask.purpose}\n\nDid this search find the expected information?`,
      })
    } catch (error) {
      const errorMsg = `Error executing search "${searchTask.query}": ${
        error instanceof Error ? error.message : 'Unknown error'
      }`

      steps.push({
        agentType: AgentType.EXEC,
        stepType: 'observation',
        content: errorMsg,
        timestamp: Date.now(),
      })

      result.queriesExecuted.push(searchTask.query)
      newlyExecuted.push(searchTask.query)
      result.collectedInfo += `\n\n[Error in search: "${searchTask.query}"]\n${errorMsg}`
    }
  }

  return { result, steps, newlyExecuted }
}

function isRelevant(observation: string): boolean {
  const observationLower = observation.toLowerCase()

  if (observationLower.includes('no results found')) return false
  if (observationLower.includes('error performing search')) return false

  const hasContent = observation.length > 100

  const hasKeywords = observationLower.includes('results') || 
                       observationLower.includes('answer') ||
                       observationLower.includes('source')

  return hasContent && hasKeywords
}