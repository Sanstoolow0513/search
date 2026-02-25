import { callLLM } from '../llm'
import { buildPlanSystemPrompt, buildReviewSystemPrompt } from './prompts'
import { getProjectFileTree } from './utils'
import { SearchStrategy, ReviewResult, AgentStep } from './types'
import { logDebug, logLLMResponse, logDebugSync } from '../utils/logger'

export async function runPlanAgent(
  userMessage: string,
  context?: string
): Promise<{ strategy: SearchStrategy; reasoning: string }> {
  const fileTree = getProjectFileTree()
  const systemPrompt = buildPlanSystemPrompt(fileTree)

  const userPrompt = context
    ? `Context: ${context}\n\nAnalyze this request and create a search strategy: ${userMessage}`
    : `Analyze this request and create a search strategy: ${userMessage}`

  const response = await callLLM(systemPrompt, [
    {
      role: 'user',
      content: userPrompt,
    },
  ])

  return parsePlanResponse(response)
}

export async function runReviewPhase(
  strategy: SearchStrategy,
  collectedInfo: string,
  planHistory: AgentStep[]
): Promise<ReviewResult> {
  const systemPrompt = buildReviewSystemPrompt()

  const reviewContext = buildReviewContext(strategy, collectedInfo, planHistory)

  const response = await callLLM(systemPrompt, [
    {
      role: 'user',
      content: reviewContext,
    },
  ])

  // Debug: Log raw LLM response
  await logLLMResponse('ReviewPhase', response)

  return parseReviewResponse(response)
}

function parsePlanResponse(response: string): { strategy: SearchStrategy; reasoning: string } {
  const strategy: SearchStrategy = {
    queries: [],
    informationGaps: [],
    confidenceLevel: 'low',
    reasoning: response,
  }

  const strategyMatch = response.match(/Strategy:([\s\S]*?)(?=Information Gaps:|$)/i)
  if (strategyMatch) {
    const strategySection = strategyMatch[1]
    const queryMatches = strategySection.matchAll(
      /Query\s+(\d+):\s*"([^"]+)"\s*-\s*Purpose:\s*([^\n]+)\s*-\s*Expected:\s*([^\n]+)/gi
    )

    for (const match of queryMatches) {
      strategy.queries.push({
        query: match[2].trim(),
        purpose: match[3].trim(),
        expectedInfo: match[4].trim(),
      })
    }
  }

  const gapsMatch = response.match(/Information Gaps:([\s\S]*?)(?=Initial Confidence:|$)/i)
  if (gapsMatch) {
    const gapsSection = gapsMatch[1]
    const gapMatches = gapsSection.matchAll(/-\s*(.+)/g)

    for (const match of gapMatches) {
      strategy.informationGaps.push(match[1].trim())
    }
  }

  const confidenceMatch = response.match(/Initial Confidence:\s*(high|medium|low)/i)
  if (confidenceMatch) {
    const conf = confidenceMatch[1].toLowerCase()
    strategy.confidenceLevel = conf as 'high' | 'medium' | 'low'
  }

  return { strategy, reasoning: response }
}

function parseReviewResponse(response: string): ReviewResult {
  const result: ReviewResult = {
    isSufficient: false,
    confidenceScore: 0,
    critique: '',
    nextAction: 'continue_search',
  }

  const confidenceMatch = response.match(/Confidence Score:\s*(\d+)/i)
  if (confidenceMatch) {
    result.confidenceScore = parseInt(confidenceMatch[1], 10)
    result.isSufficient = result.confidenceScore >= 75
  }

  const critiqueMatch = response.match(/Critique:([\s\S]*?)(?=Next Action:|$)/i)
  if (critiqueMatch) {
    result.critique = critiqueMatch[1].trim()
  }

  const actionMatch = response.match(/Next Action:\s*(finalize|refine_strategy|continue_search)/i)
  if (actionMatch) {
    result.nextAction = actionMatch[1].toLowerCase() as
      | 'finalize'
      | 'refine_strategy'
      | 'continue_search'
  }

  // Parse additional queries for both refine_strategy and continue_search
  const additionalQueries: string[] = []
  const queryMatches = response.matchAll(/Query:\s*"([^"]+)"\s*-\s*Reason:\s*([^\n]+)/gi)
  for (const match of queryMatches) {
    additionalQueries.push(match[1].trim())
  }

  if (additionalQueries.length > 0) {
    result.additionalQueries = additionalQueries
  }

  // Debug: Log parsed results
  logDebugSync('ReviewParser', 'Parsed nextAction', result.nextAction)
  logDebugSync('ReviewParser', 'Parsed confidenceScore', result.confidenceScore)
  logDebugSync('ReviewParser', 'Parsed additionalQueries count', additionalQueries.length)
  logDebugSync('ReviewParser', 'Parsed additionalQueries', additionalQueries)

  return result
}

function buildReviewContext(
  strategy: SearchStrategy,
  collectedInfo: string,
  planHistory: AgentStep[]
): string {
  let context = 'Original Strategy:\n'
  strategy.queries.forEach((q, i) => {
    context += `- Query ${i + 1}: "${q.query}"\n`
    context += `  Purpose: ${q.purpose}\n`
    context += `  Expected: ${q.expectedInfo}\n\n`
  })

  context += '\nInformation Gaps Identified:\n'
  strategy.informationGaps.forEach(gap => {
    context += `- ${gap}\n`
  })

  context += '\n\nCollected Information:\n'
  context += collectedInfo

  context += '\n\nPlan Agent Reasoning History:\n'
  planHistory.forEach(step => {
    context += `[${step.stepType.toUpperCase()}] ${step.content}\n\n`
  })

  context += '\n\nReview this information critically and provide your assessment.'

  return context
}