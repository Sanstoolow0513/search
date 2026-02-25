import { NextRequest } from 'next/server'
import { runMultiAgentLoop, MultiAgentStreamEvent } from '@/lib/agent'
import { initLogger } from '@/lib/utils/logger'

export async function POST(request: NextRequest) {
  const { message } = await request.json()

  if (!message) {
    return new Response(JSON.stringify({ error: 'Message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Initialize logger with session ID based on timestamp
  const sessionId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  await initLogger(sessionId)

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runMultiAgentLoop(message)) {
          const data = JSON.stringify(event as MultiAgentStreamEvent)
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (error) {
        const errorEvent: MultiAgentStreamEvent = {
          type: 'error',
          content: error instanceof Error ? error.message : 'Unknown error',
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}