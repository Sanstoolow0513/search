import * as fs from 'fs'
import * as path from 'path'
import { config } from '../config'
import { Tool } from '../agent/types'

export const writeTool: Tool = {
  name: 'write',
  description: 'Write content to a file in the project directory (restricted to project root)',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path where the file should be written',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file',
      },
    },
    required: ['path', 'content'],
  },
  execute: async (params: Record<string, unknown>): Promise<string> => {
    const filePath = params.path as string
    const content = params.content as string

    if (!filePath || typeof filePath !== 'string') {
      return 'Error: Invalid path parameter'
    }

    if (content === undefined || content === null) {
      return 'Error: Content parameter is required'
    }

    const absolutePath = path.resolve(config.project.rootDir, filePath)
    
    if (!absolutePath.startsWith(config.project.rootDir)) {
      return 'Error: Path traversal detected. Can only write within project directory.'
    }

    try {
      const dir = path.dirname(absolutePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      fs.writeFileSync(absolutePath, String(content), 'utf-8')
      return `Successfully wrote ${String(content).length} characters to ${filePath}`
    } catch (error) {
      return `Error writing file: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  },
}
