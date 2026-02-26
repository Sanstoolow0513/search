// ============================================
// Function Calling Types (OpenAI-compatible)
// ============================================

// JSON Schema property definition (supports nested objects and arrays)
export interface JSONSchemaProperty {
  type: string
  description?: string
  enum?: string[]
  items?: JSONSchemaProperty
  properties?: Record<string, JSONSchemaProperty>
  required?: string[]
  minimum?: number
  maximum?: number
  default?: unknown
}

// OpenAI 格式的工具定义
export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, JSONSchemaProperty>
      required?: string[]
    }
  }
}

// LLM 返回的工具调用
export interface LLMToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

// 解析后的工具调用
export interface ParsedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

// 工具执行结果
export interface ToolResult {
  toolCallId: string
  name: string
  content: string
  isError: boolean
}

// 扩展 ChatMessage 支持 tool role
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: LLMToolCall[]
  tool_call_id?: string
  name?: string
}

// LLM 响应结构
export interface LLMResponse {
  content: string | null
  toolCalls: ParsedToolCall[]
  finishReason: 'stop' | 'tool_calls' | 'length' | null
}

// ============================================
// Legacy Types
// ============================================

export interface Tool {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, JSONSchemaProperty>
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

export interface UserRequirementSpec {
  objective: string
  deliverable: string
  constraints: string[]
  assumptions: string[]
  acceptanceCriteria: string[]
  informationGaps: string[]
  needsExecAgent: boolean
  execDecisionReason: string
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
  currentSpec?: UserRequirementSpec
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
