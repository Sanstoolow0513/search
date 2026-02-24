import { config } from '../config'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function callLLM(
  systemPrompt: string,
  messages: ChatMessage[],
  onStream?: (chunk: string) => void
): Promise<string> {
  const response = await fetch(`${config.openrouter.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openrouter.apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'ReAct Agent',
    },
    body: JSON.stringify({
      model: config.openrouter.model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      stream: !!onStream,
    }),
  })

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status} ${await response.text()}`)
  }

  if (onStream && response.body) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''

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
          const content = json.choices?.[0]?.delta?.content || ''
          if (content) {
            fullContent += content
            onStream(content)
          }
        } catch {}
      }
    }

    return fullContent
  }

  const data = await response.json()
  return data.choices[0]?.message?.content || ''
}
