import * as fs from 'fs'
import * as path from 'path'

export function getProjectFileTree(): string {
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
  return files.map(f => `- ${f}`).join('\n')
}
