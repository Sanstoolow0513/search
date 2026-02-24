'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Brain, Zap, Eye, Terminal } from 'lucide-react'

type StepType = 'thought' | 'action' | 'observation' | 'final_answer'

interface Step {
  id: string
  type: StepType
  content: string
}

export function AgentChat() {
  const [steps, setSteps] = useState<Step[]>([])
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isRunning) return

    const userMessage = input.trim()
    setInput('')
    setSteps([{ id: 'user', type: 'final_answer', content: userMessage }])
    setIsRunning(true)

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      })

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n').filter(line => line.startsWith('data: '))

          for (const line of lines) {
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const event = JSON.parse(data)

              if (['thought', 'action', 'observation', 'final_answer'].includes(event.type)) {
                setSteps(prev => [...prev, {
                  id: Date.now().toString() + Math.random(),
                  type: event.type,
                  content: event.content
                }])
              }
            } catch {}
          }
        }
      }
    } catch (error) {
      setSteps(prev => [...prev, {
        id: 'error',
        type: 'final_answer',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      }])
    } finally {
      setIsRunning(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const getStepIcon = (type: StepType) => {
    switch (type) {
      case 'thought': return <Brain size={14} className="text-purple-400" />
      case 'action': return <Zap size={14} className="text-amber-400" />
      case 'observation': return <Eye size={14} className="text-emerald-400" />
      case 'final_answer': return <Terminal size={14} className="text-zinc-400" />
    }
  }

  const getStepLabel = (type: StepType) => {
    switch (type) {
      case 'thought': return 'Thought'
      case 'action': return 'Action'
      case 'observation': return 'Observation'
      case 'final_answer': return 'Final Answer'
    }
  }

  const getStepStyle = (type: StepType) => {
    switch (type) {
      case 'thought': return 'border-l-purple-500/50 bg-purple-500/5'
      case 'action': return 'border-l-amber-500/50 bg-amber-500/5'
      case 'observation': return 'border-l-emerald-500/50 bg-emerald-500/5'
      case 'final_answer': return 'border-l-zinc-500/50 bg-zinc-500/5'
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-mono text-sm">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-2">
          <Terminal size={16} className="text-zinc-500" />
          <span className="text-zinc-400">ReAct Agent</span>
          {isRunning && (
            <span className="ml-2 text-xs text-zinc-600 animate-pulse">● running</span>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto p-4 pb-32">
        {steps.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-zinc-600">
            <Terminal size={48} className="mb-4 opacity-20" />
            <p>Enter a task to see the agent work</p>
          </div>
        ) : (
          <div className="space-y-0">
            {steps.map((step, index) => (
              <div key={step.id}>
                {/* Arrow between steps */}
                {index > 0 && (
                  <div className="py-1 pl-4">
                    <span className="text-zinc-700">↓</span>
                  </div>
                )}

                {/* Step */}
                <div className={`border-l-2 ${getStepStyle(step.type)} pl-4 py-3`}>
                  <div className="flex items-center gap-2 mb-2">
                    {getStepIcon(step.type)}
                    <span className={`text-xs font-semibold uppercase tracking-wider ${
                      step.type === 'thought' ? 'text-purple-400' :
                      step.type === 'action' ? 'text-amber-400' :
                      step.type === 'observation' ? 'text-emerald-400' :
                      index === 0 ? 'text-blue-400' : 'text-zinc-300'
                    }`}>
                      {index === 0 && step.type === 'final_answer' ? 'User' : getStepLabel(step.type)}
                    </span>
                  </div>
                  <div className="text-zinc-300 leading-relaxed whitespace-pre-wrap">
                    {step.content}
                  </div>
                </div>
              </div>
            ))}
            <div ref={scrollRef} />
          </div>
        )}
      </main>

      {/* Input Area */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-zinc-800 bg-zinc-950 p-4">
        <div className="max-w-4xl mx-auto">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isRunning ? 'Agent is working...' : 'Enter a task...'}
              disabled={isRunning}
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-4 py-2 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-700 font-mono text-sm"
            />
            <button
              type="submit"
              disabled={isRunning || !input.trim()}
              className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
