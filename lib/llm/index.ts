import { config } from '../config'
import { ChatMessage, OpenAITool, ParsedToolCall, LLMResponse } from '../agent/types'

interface CallLLMOptions {
  systemPrompt: string
  messages: ChatMessage[]
  tools?: OpenAITool[]
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
  onStream?: (chunk: string) => void
}

/**
 * Parse tool calls from LLM response
 */
function parseToolCalls(toolCalls: unknown): ParsedToolCall[] {
  if (!Array.isArray(toolCalls)) return []

  return toolCalls.map(tc => {
    const rawArgs = (tc as Record<string, unknown>)?.function
      ? ((tc as Record<string, unknown>).function as Record<string, unknown>)?.arguments
      : '{}'
    let parsedArgs: Record<string, unknown> = {}

    try {
      parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs
    } catch {
      parsedArgs = {}
    }

    const funcData = (tc as Record<string, unknown>).function as Record<string, unknown> | undefined
    return {
      id: String((tc as Record<string, unknown>).id || ''),
      name: String(funcData?.name || ''),
      arguments: parsedArgs,
    }
  })
}

/**
 * Call LLM with optional function calling support
 */
export async function callLLM(options: CallLLMOptions): Promise<LLMResponse> {
  const { systemPrompt, messages, tools, toolChoice, onStream } = options

  const requestBody: Record<string, unknown> = {
    model: config.openrouter.model,
    messages: [
      { role: 'system', content: systemPrompt },
      // Filter out null content for non-tool messages
      ...messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
        ...(m.name && { name: m.name }),
      })),
    ],
    stream: !!onStream,
  }

  // Add tools support if provided
  if (tools && tools.length > 0) {
    requestBody.tools = tools
    requestBody.tool_choice = toolChoice ?? 'auto'
  }

  const response = await fetch(`${config.openrouter.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openrouter.apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'ReAct Agent',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${await response.text()}`)
  }

  // Handle streaming response
  if (onStream && response.body) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    const toolCalls: ParsedToolCall[] = []
    let finishReason: LLMResponse['finishReason'] = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n').filter(line => line.startsWith('data: '))

      for (const line of lines) {
        const data = line.slice(6)
        if (data === '[DONE]') continue

        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta
          const finish = json.choices?.[0]?.finish_reason

          if (delta?.content) {
            fullContent += delta.content
            onStream(delta.content)
          }

          // Handle tool calls in streaming (they come in delta.tool_calls)
          if (delta?.tool_calls) {
            // Accumulate tool call chunks - this is complex in streaming
            // For simplicity, we'll rely on non-streaming for tool calls
          }

          if (finish) {
            finishReason = finish as LLMResponse['finishReason']
          }
        } catch {
          // Ignore parse errors in streaming
        }
      }
    }

    return {
      content: fullContent || null,
      toolCalls,
      finishReason,
    }
  }

  // Non-streaming response
  const data = await response.json()
  const msg = data.choices?.[0]?.message

  return {
    content: msg?.content || null,
    toolCalls: parseToolCalls(msg?.tool_calls || []),
    finishReason: data.choices?.[0]?.finish_reason || null,
  }
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use callLLM with options object instead
 */
export async function callLLMLegacy(
  systemPrompt: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  onStream?: (chunk: string) => void
): Promise<string> {
  const result = await callLLM({
    systemPrompt,
    messages: messages.map(m => ({ ...m, content: m.content })),
    onStream,
  })
  return result.content || ''
}