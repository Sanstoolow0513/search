import { clearSearchHistory } from '../tools/web-search'
import { runPlanAgent, runReviewPhase } from './plan-agent'
import { runExecAgent } from './exec-agent'
import { callLLM } from '../llm'
import { CoordinationState, MultiAgentStreamEvent, AgentType, AgentStep, SearchStrategy } from './types'
import { logDebug, initLogger } from '../utils/logger'

const MAX_ITERATIONS = 5
const CONFIDENCE_THRESHOLD = 75

export async function* runMultiAgentLoop(
  userMessage: string,
  maxIterations: number = MAX_ITERATIONS
): AsyncGenerator<MultiAgentStreamEvent, CoordinationState> {
  clearSearchHistory()

  const state: CoordinationState = {
    userMessage,
    planSteps: [],
    execSteps: [],
    isComplete: false,
    iterationCount: 0,
  }

  // Track executed queries and accumulated info across iterations
  const executedQueries = new Set<string>()
  let allCollectedInfo = ''

  yield {
    type: 'phase',
    content: 'Planning Phase',
    phase: 'Planning',
  }

  try {
    const { strategy, reasoning } = await runPlanAgent(userMessage)

    state.planSteps.push({
      agentType: AgentType.PLAN,
      stepType: 'thought',
      content: reasoning,
    })

    yield {
      type: 'plan_thought',
      agent: AgentType.PLAN,
      content: formatStrategyOutput(strategy),
    }

    state.currentStrategy = strategy

    while (!state.isComplete && state.iterationCount < maxIterations) {
      state.iterationCount++

      // Debug: Log iteration start
      await logDebug('Coordinator', `=== Iteration ${state.iterationCount} ===`)
      await logDebug('Coordinator', 'Current strategy queries', state.currentStrategy?.queries.length)
      await logDebug('Coordinator', 'Executed queries size', executedQueries.size)

      yield {
        type: 'phase',
        content: `Execution Round ${state.iterationCount}`,
        phase: 'Execution',
      }

      const { result: execResult, steps: execSteps, newlyExecuted } = await runExecAgent(
        state.currentStrategy!,
        executedQueries
      )

      state.execSteps.push(...execSteps)

      // Track executed queries and accumulated info
      newlyExecuted.forEach(q => executedQueries.add(q))
      allCollectedInfo += execResult.collectedInfo

      yield {
        type: 'exec_action',
        agent: AgentType.EXEC,
        content: `Executed ${newlyExecuted.length} new searches (${executedQueries.size} total)`,
      }

      yield {
        type: 'phase',
        content: 'Review Phase',
        phase: 'Review',
      }

      const review = await runReviewPhase(
        state.currentStrategy!,
        allCollectedInfo,
        state.planSteps
      )

      state.planSteps.push({
        agentType: AgentType.PLAN,
        stepType: 'review',
        content: `Confidence: ${review.confidenceScore}/100\n\n${review.critique}`,
      })

      yield {
        type: 'review',
        agent: AgentType.PLAN,
        content: `Confidence Score: ${review.confidenceScore}/100\n\nCritique:\n${review.critique}`,
      }

      if (review.confidenceScore >= CONFIDENCE_THRESHOLD || review.nextAction === 'finalize') {
        state.isComplete = true
        const finalAnswer = await generateFinalAnswer(
          userMessage,
          allCollectedInfo,
          state.planSteps
        )

        state.finalAnswer = finalAnswer

        yield {
          type: 'final_answer',
          agent: AgentType.PLAN,
          content: finalAnswer,
        }

        break
      } else if (review.nextAction === 'refine_strategy' && review.additionalQueries) {
        // Debug: Log refine_strategy branch
        await logDebug('Coordinator', 'Branch: refine_strategy')
        await logDebug('Coordinator', 'review.additionalQueries', review.additionalQueries)

        state.currentStrategy = refineStrategy(
          state.currentStrategy,
          review.additionalQueries
        )

        state.planSteps.push({
          agentType: AgentType.PLAN,
          stepType: 'thought',
          content: `Refined strategy with ${review.additionalQueries.length} new queries`,
        })

        yield {
          type: 'plan_thought',
          agent: AgentType.PLAN,
          content: formatStrategyOutput(state.currentStrategy),
        }
      } else if (review.nextAction === 'continue_search' && review.additionalQueries) {
        // Debug: Log continue_search branch
        await logDebug('Coordinator', 'Branch: continue_search')
        await logDebug('Coordinator', 'review.additionalQueries', review.additionalQueries)

        // Handle continue_search: use additional queries as new strategy
        state.currentStrategy = {
          ...state.currentStrategy,
          queries: review.additionalQueries.map(query => ({
            query,
            purpose: 'Additional search based on review feedback',
            expectedInfo: 'Information to address identified gaps',
          })),
        }

        await logDebug('Coordinator', 'New strategy queries count', state.currentStrategy.queries.length)

        state.planSteps.push({
          agentType: AgentType.PLAN,
          stepType: 'thought',
          content: `Continuing search with ${review.additionalQueries.length} additional queries`,
        })

        yield {
          type: 'plan_thought',
          agent: AgentType.PLAN,
          content: formatStrategyOutput(state.currentStrategy),
        }
      } else {
        // Debug: Log fallback branch
        await logDebug('Coordinator', 'Branch: FALLBACK - no action taken')
        await logDebug('Coordinator', 'review.nextAction', review.nextAction)
        await logDebug('Coordinator', 'review.additionalQueries', review.additionalQueries)
      }

      yield {
        type: 'phase',
        content: 'Continuing search...',
        phase: 'Continue',
      }
    }

    if (!state.isComplete) {
      yield {
        type: 'error',
        content: `Max iterations (${maxIterations}) reached without sufficient confidence. Best effort answer follows.`,
      }

      const finalAnswer = await generateFinalAnswer(
        userMessage,
        allCollectedInfo,
        state.planSteps
      )

      state.finalAnswer = finalAnswer

      yield {
        type: 'final_answer',
        agent: AgentType.PLAN,
        content: finalAnswer,
      }
    }
  } catch (error) {
    yield {
      type: 'error',
      content: `Coordinator error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }

  return state
}

async function generateFinalAnswer(
  userMessage: string,
  collectedInfo: string,
  planHistory: AgentStep[]
): Promise<string> {
  const systemPrompt = `You are an Answer Synthesis Agent. Your role is to:

1. Synthesize the collected information into a comprehensive answer
2. Cite sources clearly
3. Admit uncertainty where information is incomplete
4. Be direct and concise

Response Format:
Final Answer: [your complete answer]

Include citations where relevant. If information is uncertain or contradictory, state this explicitly.`

  const userPrompt = `Original Question: ${userMessage}

Collected Information:
${collectedInfo}

Plan Agent Reasoning:
${planHistory.map(s => s.content).join('\n\n')}

Provide a final answer based on this information.`

  try {
    const response = await callLLM(systemPrompt, [
      { role: 'user', content: userPrompt },
    ])

    const finalAnswerMatch = response.match(/Final Answer:\s*([\s\S]+)/i)
    if (finalAnswerMatch) {
      return finalAnswerMatch[1].trim()
    }

    return response
  } catch (error) {
    return `Error generating final answer: ${error instanceof Error ? error.message : 'Unknown error'}`
  }
}

function formatStrategyOutput(strategy: SearchStrategy): string {
  let output = 'Search Strategy:\n\n'
  strategy.queries.forEach((q, i) => {
    output += `${i + 1}. Query: "${q.query}"\n`
    output += `   Purpose: ${q.purpose}\n`
    output += `   Expected: ${q.expectedInfo}\n\n`
  })

  if (strategy.informationGaps.length > 0) {
    output += 'Information Gaps:\n'
    strategy.informationGaps.forEach(gap => {
      output += `- ${gap}\n`
    })
  }

  output += `\nInitial Confidence: ${strategy.confidenceLevel}`

  return output
}

function refineStrategy(
  currentStrategy: SearchStrategy,
  refinedQueries: string[]
): SearchStrategy {
  const newQueries = refinedQueries.map(query => ({
    query,
    purpose: 'Refined search based on review feedback',
    expectedInfo: 'Additional information to address gaps',
  }))

  return {
    ...currentStrategy,
    queries: [...currentStrategy.queries, ...newQueries],
  }
}