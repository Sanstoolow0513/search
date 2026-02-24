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
