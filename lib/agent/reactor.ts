import { AgentState, ReActStep, StreamEvent, ChatMessage } from './types'
import { callLLM } from '../llm'
import { executeTool } from '../tools'
import { clearSearchHistory } from '../tools/web-search'
import { buildSystemPrompt, getFileTreePrompt } from '../llm/prompts'
import * as fs from 'fs'
import * as path from 'path'

function parseReActResponse(response: string): ReActStep {
  const step: ReActStep = {}

  const thoughtMatch = response.match(/Thought:\s*([\s\S]*?)(?=\n(?:Action|Final|$))/i)
  if (thoughtMatch) {
    step.thought = thoughtMatch[1].trim()
  }

  const actionMatch = response.match(/Action:\s*(\w+)/i)
  if (actionMatch) {
    step.action = actionMatch[1].trim()
  }

  const actionInputMatch = response.match(/Action Input:\s*({[\s\S]*?})(?=\n|$)/i)
  if (actionInputMatch) {
    try {
      step.actionInput = JSON.parse(actionInputMatch[1])
    } catch {
      step.actionInput = {}
    }
  }

  const finalAnswerMatch = response.match(/Final Answer:\s*([\s\S]*?)$/i)
  if (finalAnswerMatch) {
    step.finalAnswer = finalAnswerMatch[1].trim()
  }

  return step
}

function getProjectFileTree(): string {
  const rootDir = process.cwd()
  const files: string[] = []

  function walk(dir: string, base: string = '') {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
        if (entry.name === 'node_modules') continue

        const relativePath = base ? `${base}/${entry.name}` : entry.name
        files.push(relativePath)

        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), relativePath)
        }
      }
    } catch {}
  }

  walk(rootDir)
  return getFileTreePrompt(files)
}

export async function* runReActLoop(
  userMessage: string,
  maxIterations: number = 25
): AsyncGenerator<StreamEvent, AgentState, unknown> {
  // Clear search history at the start of each new conversation
  clearSearchHistory()

  const fileTree = getProjectFileTree()
  const systemPrompt = buildSystemPrompt(fileTree)

  const state: AgentState = {
    steps: [],
    isComplete: false,
  }

  const conversationHistory: ChatMessage[] = []
  conversationHistory.push({ role: 'user', content: userMessage })

  let iteration = 0

  while (!state.isComplete && iteration < maxIterations) {
    iteration++

    let response: string

    try {
      const result = await callLLM({
        systemPrompt,
        messages: conversationHistory,
      })
      response = result.content || ''
    } catch (error) {
      yield {
        type: 'error',
        content: `LLM error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
      return state
    }

    conversationHistory.push({ role: 'assistant', content: response })

    const step = parseReActResponse(response)
    state.steps.push(step)

    if (step.thought) {
      yield { type: 'thought', content: step.thought }
    }

    if (step.finalAnswer) {
      state.isComplete = true
      state.finalAnswer = step.finalAnswer
      yield { type: 'final_answer', content: step.finalAnswer }
      return state
    }

    if (step.action && step.actionInput) {
      yield {
        type: 'action',
        content: `${step.action}(${JSON.stringify(step.actionInput)})`,
      }

      const observation = await executeTool(step.action, step.actionInput)
      step.observation = observation

      yield { type: 'observation', content: observation }

      // Add progress reminder after observation to keep agent focused
      let observationWithContext = `Observation: ${observation}`

      // After search results, remind agent to stay focused
      if (step.action === 'web_search' && iteration > 3) {
        observationWithContext += `\n\n[Reminder] You have used ${iteration} iterations. Stay focused on the original question: "${userMessage}". Avoid tangential searches.`
      }

      conversationHistory.push({
        role: 'user',
        content: observationWithContext,
      })
    }
  }

  if (!state.isComplete) {
    yield {
      type: 'error',
      content: 'Max iterations reached without final answer',
    }
  }

  return state
}
