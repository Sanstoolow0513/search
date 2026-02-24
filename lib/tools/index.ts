import { Tool } from '../agent/types'
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
