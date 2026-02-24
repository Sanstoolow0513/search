import * as fs from 'fs'
import * as path from 'path'
import { config } from '../config'
import { Tool } from '../agent/types'

export const readTool: Tool = {
  name: 'read',
  description: 'Read a file from the project directory',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file to read',
      },
    },
    required: ['path'],
  },
  execute: async (params: Record<string, unknown>): Promise<string> => {
    const filePath = params.path as string
    
    if (!filePath || typeof filePath !== 'string') {
      return 'Error: Invalid path parameter'
    }

    const absolutePath = path.resolve(config.project.rootDir, filePath)
    
    if (!absolutePath.startsWith(config.project.rootDir)) {
      return 'Error: Path traversal detected. Access denied.'
    }

    if (!fs.existsSync(absolutePath)) {
      return `Error: File not found: ${filePath}`
    }

    try {
      const stats = fs.statSync(absolutePath)
      
      if (stats.isDirectory()) {
        const files = fs.readdirSync(absolutePath)
        return `Directory contents of ${filePath}:\n${files.map(f => `- ${f}`).join('\n')}`
      }

      if (stats.size > config.project.maxFileSize) {
        return `Error: File too large (${stats.size} bytes). Max allowed: ${config.project.maxFileSize} bytes`
      }

      const content = fs.readFileSync(absolutePath, 'utf-8')
      return `File: ${filePath}\n\n${content}`
    } catch (error) {
      return `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  },
}
