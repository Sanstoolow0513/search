export interface Tool {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, {
      type: string
      description: string
    }>
    required: string[]
  }
  execute: (params: Record<string, unknown>) => Promise<string>
}

export interface ReActStep {
  thought?: string
  action?: string
  actionInput?: Record<string, unknown>
  observation?: string
  finalAnswer?: string
}

export interface AgentState {
  steps: ReActStep[]
  isComplete: boolean
  finalAnswer?: string
}

export interface AgentRequest {
  message: string
  context?: string
}

export interface StreamEvent {
  type: 'thought' | 'action' | 'observation' | 'final_answer' | 'error'
  content: string
}

export enum AgentType {
  PLAN = 'plan',
  EXEC = 'exec'
}

export interface AgentStep {
  agentType: AgentType
  stepType: 'thought' | 'action' | 'observation' | 'review'
  content: string
  timestamp?: number
}

export interface SearchQuery {
  query: string
  purpose: string
  expectedInfo: string
}

export interface SearchStrategy {
  queries: SearchQuery[]
  informationGaps: string[]
  confidenceLevel: 'high' | 'medium' | 'low'
  reasoning: string
}

export interface ReviewResult {
  isSufficient: boolean
  confidenceScore: number
  critique: string
  nextAction: 'finalize' | 'refine_strategy' | 'continue_search'
  additionalQueries?: string[]
}

export interface ExecAgentResult {
  collectedInfo: string
  queriesExecuted: string[]
  successfulSearches: number
}

export interface CoordinationState {
  userMessage: string
  planSteps: AgentStep[]
  execSteps: AgentStep[]
  currentStrategy?: SearchStrategy
  isComplete: boolean
  finalAnswer?: string
  iterationCount: number
}

export interface MultiAgentStreamEvent {
  type: 'plan_thought' | 'plan_action' | 'exec_thought' | 
        'exec_action' | 'observation' | 'review' | 'final_answer' | 'error' | 'phase'
  agent?: AgentType
  content: string
  phase?: string
}
