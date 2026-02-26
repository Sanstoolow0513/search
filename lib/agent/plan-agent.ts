import { callLLM } from '../llm'
import { buildPlanSystemPrompt, buildReviewSystemPrompt } from './prompts'
import { getProjectFileTree } from './utils'
import {
  SearchStrategy,
  UserRequirementSpec,
  ReviewResult,
  AgentStep,
  OpenAITool,
  ChatMessage,
} from './types'
import { logLLMResponse, logDebugSync } from '../utils/logger'

// ============================================
// Tool Definitions for Plan Agent
// ============================================

const specUserRequirementTool: OpenAITool = {
  type: 'function',
  function: {
    name: 'spec_user_requirement',
    description: 'Create a structured requirement spec and decide whether Exec Agent execution is needed',
    parameters: {
      type: 'object',
      properties: {
        objective: {
          type: 'string',
          description: 'Core user objective in one clear sentence',
        },
        deliverable: {
          type: 'string',
          description: 'Expected output format or deliverable for the user',
        },
        constraints: {
          type: 'array',
          description: 'Explicit constraints from user or context',
          items: { type: 'string' },
        },
        assumptions: {
          type: 'array',
          description: 'Assumptions made while interpreting the request',
          items: { type: 'string' },
        },
        acceptanceCriteria: {
          type: 'array',
          description: 'Criteria that define a successful response',
          items: { type: 'string' },
        },
        informationGaps: {
          type: 'array',
          description: 'Key information gaps that need to be addressed',
          items: { type: 'string' },
        },
        needsExecAgent: {
          type: 'boolean',
          description: 'Whether Exec Agent must be invoked',
        },
        execDecisionReason: {
          type: 'string',
          description: 'Reason for invoking or skipping Exec Agent',
        },
        queries: {
          type: 'array',
          description: 'Execution queries for Exec Agent when needsExecAgent=true',
          items: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Concise search query (no filler words)',
              },
              purpose: {
                type: 'string',
                description: 'Why this search is needed',
              },
              expectedInfo: {
                type: 'string',
                description: 'What specific facts/data you expect to find',
              },
            },
            required: ['query', 'purpose', 'expectedInfo'],
          },
        },
        confidenceLevel: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Confidence level of requirement specification completeness',
        },
        reasoning: {
          type: 'string',
          description: 'Brief explanation of the specification and routing decision',
        },
      },
      required: ['objective', 'deliverable', 'needsExecAgent', 'execDecisionReason'],
    },
  },
}

const submitReviewTool: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_review',
    description: 'Submit your review of the collected information with confidence score and next action',
    parameters: {
      type: 'object',
      properties: {
        confidenceScore: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
          description: 'Confidence score (0-100). 80+ = strong evidence, 50-79 = moderate, <50 = weak',
        },
        critique: {
          type: 'string',
          description: 'Detailed critique of the collected information',
        },
        nextAction: {
          type: 'string',
          enum: ['finalize', 'refine_strategy', 'continue_search'],
          description: 'finalize = sufficient info, refine_strategy = add queries to current, continue_search = new queries needed',
        },
        additionalQueries: {
          type: 'array',
          description: 'Additional queries if nextAction is refine_strategy or continue_search',
          items: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'The search query' },
              reason: { type: 'string', description: 'Why this query is needed' },
            },
            required: ['query', 'reason'],
          },
        },
        evidenceQuality: {
          type: 'string',
          description: 'Assessment of evidence quality',
        },
        assumptionsDetected: {
          type: 'array',
          description: 'List of assumptions identified in reasoning',
          items: { type: 'string' },
        },
        informationGaps: {
          type: 'array',
          description: 'Remaining information gaps',
          items: { type: 'string' },
        },
      },
      required: ['confidenceScore', 'critique', 'nextAction'],
    },
  },
}

// ============================================
// Plan Agent Functions
// ============================================

export async function runPlanAgent(
  userMessage: string,
  context?: string
): Promise<{ spec: UserRequirementSpec; strategy: SearchStrategy; reasoning: string }> {
  const fileTree = getProjectFileTree()
  const systemPrompt = buildPlanSystemPrompt(fileTree)

  const userPrompt = context
    ? `Context: ${context}\n\nAnalyze this request, create a requirement specification, and decide whether Exec Agent execution is needed: ${userMessage}`
    : `Analyze this request, create a requirement specification, and decide whether Exec Agent execution is needed: ${userMessage}`

  const messages: ChatMessage[] = [
    { role: 'user', content: userPrompt },
  ]

  const result = await callLLM({
    systemPrompt,
    messages,
    tools: [specUserRequirementTool],
    toolChoice: { type: 'function', function: { name: 'spec_user_requirement' } },
  })

  // Debug: Log raw response
  await logLLMResponse('PlanAgent', JSON.stringify(result, null, 2))

  // Extract specification + optional execution strategy from tool call
  const strategyCall = result.toolCalls.find(tc => tc.name === 'spec_user_requirement')

  if (strategyCall) {
    const args = strategyCall.arguments as {
      objective: string
      deliverable: string
      constraints?: string[]
      assumptions?: string[]
      acceptanceCriteria?: string[]
      needsExecAgent?: boolean
      execDecisionReason?: string
      queries: Array<{ query: string; purpose: string; expectedInfo: string }>
      informationGaps?: string[]
      confidenceLevel?: string
      reasoning?: string
    }

    const spec: UserRequirementSpec = {
      objective: args.objective || 'Clarify user objective',
      deliverable: args.deliverable || 'Direct answer',
      constraints: args.constraints || [],
      assumptions: args.assumptions || [],
      acceptanceCriteria: args.acceptanceCriteria || [],
      informationGaps: args.informationGaps || [],
      needsExecAgent: Boolean(args.needsExecAgent),
      execDecisionReason: args.execDecisionReason || 'No routing reason provided',
    }

    const strategy: SearchStrategy = {
      queries: spec.needsExecAgent ? (args.queries || []) : [],
      informationGaps: spec.informationGaps,
      confidenceLevel: (args.confidenceLevel as 'high' | 'medium' | 'low') || 'low',
      reasoning: args.reasoning || result.content || '',
    }

    return { spec, strategy, reasoning: strategy.reasoning }
  }

  // Fallback: try to parse from content if no tool call
  logDebugSync('PlanAgent', 'No tool call found, using fallback parsing')
  return parsePlanResponse(result.content || '')
}

export async function runReviewPhase(
  strategy: SearchStrategy,
  collectedInfo: string,
  planHistory: AgentStep[]
): Promise<ReviewResult> {
  const systemPrompt = buildReviewSystemPrompt()
  const reviewContext = buildReviewContext(strategy, collectedInfo, planHistory)

  const messages: ChatMessage[] = [
    { role: 'user', content: reviewContext },
  ]

  const result = await callLLM({
    systemPrompt,
    messages,
    tools: [submitReviewTool],
    toolChoice: { type: 'function', function: { name: 'submit_review' } },
  })

  // Debug: Log raw response
  await logLLMResponse('ReviewPhase', JSON.stringify(result, null, 2))

  // Extract review from tool call
  const reviewCall = result.toolCalls.find(tc => tc.name === 'submit_review')

  if (reviewCall) {
    const args = reviewCall.arguments as {
      confidenceScore: number
      critique: string
      nextAction: 'finalize' | 'refine_strategy' | 'continue_search'
      additionalQueries?: Array<{ query: string; reason: string }>
      evidenceQuality?: string
      assumptionsDetected?: string[]
      informationGaps?: string[]
    }

    const reviewResult: ReviewResult = {
      isSufficient: args.confidenceScore >= 75,
      confidenceScore: args.confidenceScore,
      critique: args.critique,
      nextAction: args.nextAction,
      additionalQueries: args.additionalQueries?.map(q => q.query),
    }

    logDebugSync('ReviewPhase', 'Parsed from tool call', reviewResult)
    return reviewResult
  }

  // Fallback: try to parse from content
  logDebugSync('ReviewPhase', 'No tool call found, using fallback parsing')
  return parseReviewResponse(result.content || '')
}

// ============================================
// Fallback Parsers (for backward compatibility)
// ============================================

function parsePlanResponse(response: string): { spec: UserRequirementSpec; strategy: SearchStrategy; reasoning: string } {
  const spec: UserRequirementSpec = {
    objective: 'Clarify user objective',
    deliverable: 'Direct answer',
    constraints: [],
    assumptions: [],
    acceptanceCriteria: [],
    informationGaps: [],
    needsExecAgent: false,
    execDecisionReason: 'Fallback parser: no structured tool call returned',
  }

  const strategy: SearchStrategy = {
    queries: [],
    informationGaps: [],
    confidenceLevel: 'low',
    reasoning: response,
  }

  const objectiveMatch = response.match(/Objective:\s*([^\n]+)/i)
  if (objectiveMatch) {
    spec.objective = objectiveMatch[1].trim()
  }

  const deliverableMatch = response.match(/Deliverable:\s*([^\n]+)/i)
  if (deliverableMatch) {
    spec.deliverable = deliverableMatch[1].trim()
  }

  const needsExecMatch = response.match(/Needs Exec Agent:\s*(true|false|yes|no)/i)
  if (needsExecMatch) {
    const value = needsExecMatch[1].toLowerCase()
    spec.needsExecAgent = value === 'true' || value === 'yes'
  }

  const decisionMatch = response.match(/Exec Decision Reason:\s*([^\n]+)/i)
  if (decisionMatch) {
    spec.execDecisionReason = decisionMatch[1].trim()
  }

  const strategyMatch = response.match(/(?:Strategy|Queries):([\s\S]*?)(?=Information Gaps:|$)/i)
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
      const gap = match[1].trim()
      strategy.informationGaps.push(gap)
      spec.informationGaps.push(gap)
    }
  }

  const confidenceMatch = response.match(/Initial Confidence:\s*(high|medium|low)/i)
  if (confidenceMatch) {
    const conf = confidenceMatch[1].toLowerCase()
    strategy.confidenceLevel = conf as 'high' | 'medium' | 'low'
  }

  if (!needsExecMatch) {
    spec.needsExecAgent = strategy.queries.length > 0
  }

  if (spec.needsExecAgent && strategy.queries.length === 0) {
    strategy.queries.push({
      query: spec.objective,
      purpose: 'Fallback execution query from parsed objective',
      expectedInfo: 'Information needed to fulfill the objective',
    })
  }

  if (!spec.needsExecAgent) {
    strategy.queries = []
  }

  return { spec, strategy, reasoning: response }
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

  const additionalQueries: string[] = []
  const queryMatches = response.matchAll(/Query:\s*"([^"]+)"\s*-\s*Reason:\s*([^\n]+)/gi)
  for (const match of queryMatches) {
    additionalQueries.push(match[1].trim())
  }

  if (additionalQueries.length > 0) {
    result.additionalQueries = additionalQueries
  }

  logDebugSync('ReviewParser', 'Parsed nextAction', result.nextAction)
  logDebugSync('ReviewParser', 'Parsed confidenceScore', result.confidenceScore)
  logDebugSync('ReviewParser', 'Parsed additionalQueries count', additionalQueries.length)

  return result
}

// ============================================
// Helper Functions
// ============================================

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

  context += '\n\nReview this information critically and provide your assessment using the submit_review tool.'

  return context
}
