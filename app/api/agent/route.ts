import { NextRequest } from 'next/server'
import { runReActLoop, StreamEvent } from '@/lib/agent'

export async function POST(request: NextRequest) {
  const { message } = await request.json()

  if (!message) {
    return new Response(JSON.stringify({ error: 'Message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runReActLoop(message)) {
          const data = JSON.stringify(event as StreamEvent)
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (error) {
        const errorEvent: StreamEvent = {
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
      Connection: 'keep-alive',
    },
  })
}
