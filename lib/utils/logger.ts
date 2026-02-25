import { promises as fs } from 'fs'
import path from 'path'

const LOG_DIR = path.join(process.cwd(), 'log')
let logFilePath: string | null = null

function getTimestamp(): string {
  const now = new Date()
  return now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function formatMessage(level: string, message: string): string {
  const timestamp = new Date().toISOString()
  return `[${timestamp}] [${level}] ${message}\n`
}

async function ensureLogDir(): Promise<void> {
  try {
    await fs.access(LOG_DIR)
  } catch {
    await fs.mkdir(LOG_DIR, { recursive: true })
  }
}

export async function initLogger(sessionId?: string): Promise<void> {
  await ensureLogDir()
  const filename = sessionId ? `${sessionId}.log` : `${getTimestamp()}.log`
  logFilePath = path.join(LOG_DIR, filename)

  // Write header
  await fs.writeFile(
    logFilePath,
    `=== Agent Session Log ===\nStarted: ${new Date().toISOString()}\nSession: ${sessionId || 'auto-generated'}\n\n`
  )
}

export async function logDebug(module: string, message: string, data?: unknown): Promise<void> {
  const fullMessage = `[${module}] ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}`

  // Always log to console
  console.log(fullMessage)

  // Also write to file if initialized
  if (logFilePath) {
    try {
      await fs.appendFile(logFilePath, formatMessage('DEBUG', fullMessage))
    } catch (error) {
      console.error(`[Logger] Failed to write to log file: ${error}`)
    }
  }
}

export async function logInfo(module: string, message: string, data?: unknown): Promise<void> {
  const fullMessage = `[${module}] ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}`

  console.info(fullMessage)

  if (logFilePath) {
    try {
      await fs.appendFile(logFilePath, formatMessage('INFO', fullMessage))
    } catch (error) {
      console.error(`[Logger] Failed to write to log file: ${error}`)
    }
  }
}

export async function logError(module: string, message: string, error?: unknown): Promise<void> {
  const errorDetails = error instanceof Error ? `\n${error.stack || error.message}` : error ? `\n${JSON.stringify(error, null, 2)}` : ''
  const fullMessage = `[${module}] ${message}${errorDetails}`

  console.error(fullMessage)

  if (logFilePath) {
    try {
      await fs.appendFile(logFilePath, formatMessage('ERROR', fullMessage))
    } catch (e) {
      console.error(`[Logger] Failed to write to log file: ${e}`)
    }
  }
}

export async function logLLMResponse(module: string, response: string, label?: string): Promise<void> {
  const header = label || 'Raw LLM Response'
  const fullMessage = `[${module}] === ${header} ===\n${response}\n[${module}] === End ${header} ===`

  console.log(fullMessage)

  if (logFilePath) {
    try {
      await fs.appendFile(logFilePath, formatMessage('LLM', fullMessage))
    } catch (error) {
      console.error(`[Logger] Failed to write to log file: ${error}`)
    }
  }
}

// Synchronous version for non-async contexts (falls back to console only)
export function logDebugSync(module: string, message: string, data?: unknown): void {
  const fullMessage = `[${module}] ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}`
  console.log(fullMessage)

  // Fire and forget file write
  if (logFilePath) {
    fs.appendFile(logFilePath, formatMessage('DEBUG', fullMessage)).catch(() => {
      // Silent fail for sync version
    })
  }
}
