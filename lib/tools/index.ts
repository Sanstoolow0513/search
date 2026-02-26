import { Tool, OpenAITool, ParsedToolCall, ToolResult } from '../agent/types'
import { readTool } from './read'
import { writeTool } from './write'
import { webSearchTool } from './web-search'

export const tools: Record<string, Tool> = {
  read: readTool,
  write: writeTool,
  web_search: webSearchTool,
}

export function getToolDescriptions(): string {
  return Object.values(tools)
    .map(t => `- ${t.name}: ${t.description}`)
    .join('\n')
}

export async function executeTool(
  name: string,
  params: Record<string, unknown>
): Promise<string> {
  const tool = tools[name]

  if (!tool) {
    return `Error: Unknown tool "${name}". Available tools: ${Object.keys(tools).join(', ')}`
  }

  return tool.execute(params)
}

/**
 * Convert internal tools to OpenAI function calling format
 */
export function toOpenAITools(): OpenAITool[] {
  return Object.values(tools).map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

/**
 * Execute a parsed tool call from LLM response
 */
export async function executeToolCall(call: ParsedToolCall): Promise<ToolResult> {
  try {
    const content = await executeTool(call.name, call.arguments)
    return {
      toolCallId: call.id,
      name: call.name,
      content,
      isError: false,
    }
  } catch (e) {
    return {
      toolCallId: call.id,
      name: call.name,
      content: e instanceof Error ? e.message : String(e),
      isError: true,
    }
  }
}
