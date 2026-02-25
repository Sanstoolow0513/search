'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Brain, Zap, Eye, Terminal } from 'lucide-react'

type StepType = 'thought' | 'action' | 'observation' | 'final_answer' | 'review' | 'phase'
type AgentType = 'plan' | 'exec'

interface Step {
  id: string
  type: StepType
  agent?: AgentType
  content: string
  phase?: string
}

interface AgentPanel {
  steps: Step[]
  latestConfidence?: number
}

export function AgentChat() {
  const [allSteps, setAllSteps] = useState<Step[]>([])
  const [planPanel, setPlanPanel] = useState<AgentPanel>({ steps: [] })
  const [execPanel, setExecPanel] = useState<AgentPanel>({ steps: [] })
  const [currentPhase, setCurrentPhase] = useState<string>('')
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [allSteps])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isRunning) return

    const userMessage = input.trim()
    setInput('')
    
    const initialStep: Step = {
      id: 'user',
      type: 'final_answer',
      content: userMessage,
    }
    
    setAllSteps([initialStep])
    setPlanPanel({ steps: [] })
    setExecPanel({ steps: [] })
    setCurrentPhase('')
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

              if (event.type === 'phase') {
                setCurrentPhase(event.phase || '')
                setAllSteps(prev => [...prev, {
                  id: Date.now().toString() + Math.random(),
                  type: 'phase',
                  content: event.content,
                  phase: event.phase,
                }])
              } else if (['plan_thought', 'plan_action', 'review'].includes(event.type)) {
                const step: Step = {
                  id: Date.now().toString() + Math.random(),
                  type: event.type === 'plan_thought' ? 'thought' : 
                        event.type === 'plan_action' ? 'action' : 
                        event.type === 'review' ? 'review' : 'thought',
                  agent: 'plan',
                  content: event.content,
                }
                setPlanPanel(prev => ({ ...prev, steps: [...prev.steps, step] }))
                setAllSteps(prev => [...prev, step])

                if (event.type === 'review') {
                  const confidenceMatch = event.content.match(/Confidence Score:\s*(\d+)/i)
                  if (confidenceMatch) {
                    setPlanPanel(prev => ({
                      ...prev,
                      latestConfidence: parseInt(confidenceMatch[1], 10),
                    }))
                  }
                }
              } else if (['exec_thought', 'exec_action', 'observation'].includes(event.type)) {
                const step: Step = {
                  id: Date.now().toString() + Math.random(),
                  type: event.type === 'exec_thought' ? 'thought' :
                        event.type === 'exec_action' ? 'action' : 'observation',
                  agent: 'exec',
                  content: event.content,
                }
                setExecPanel(prev => ({ ...prev, steps: [...prev.steps, step] }))
                setAllSteps(prev => [...prev, step])
              } else if (event.type === 'final_answer') {
                const step: Step = {
                  id: Date.now().toString() + Math.random(),
                  type: 'final_answer',
                  agent: 'plan',
                  content: event.content,
                }
                setPlanPanel(prev => ({ ...prev, steps: [...prev.steps, step] }))
                setAllSteps(prev => [...prev, step])
              } else if (event.type === 'error') {
                const step: Step = {
                  id: Date.now().toString() + Math.random(),
                  type: 'final_answer',
                  content: `Error: ${event.content}`,
                }
                setAllSteps(prev => [...prev, step])
              }
            } catch {}
          }
        }
      }
    } catch (error) {
      setAllSteps(prev => [...prev, {
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
      case 'review': return <Brain size={14} className="text-blue-400" />
      case 'final_answer': return <Terminal size={14} className="text-zinc-400" />
      case 'phase': return <Zap size={14} className="text-cyan-400" />
    }
  }

  const getStepLabel = (type: StepType, agent?: AgentType) => {
    switch (type) {
      case 'thought': return agent === 'plan' ? 'Plan Thought' : 'Exec Thought'
      case 'action': return agent === 'plan' ? 'Plan Action' : 'Exec Action'
      case 'observation': return 'Observation'
      case 'review': return 'Review'
      case 'final_answer': return 'Final Answer'
      case 'phase': return 'Phase'
    }
  }

  const getStepStyle = (type: StepType) => {
    switch (type) {
      case 'thought': return 'border-l-purple-500/50 bg-purple-500/5'
      case 'action': return 'border-l-amber-500/50 bg-amber-500/5'
      case 'observation': return 'border-l-emerald-500/50 bg-emerald-500/5'
      case 'review': return 'border-l-blue-500/50 bg-blue-500/5'
      case 'final_answer': return 'border-l-zinc-500/50 bg-zinc-500/5'
      case 'phase': return 'border-l-cyan-500/50 bg-cyan-500/5'
    }
  }

  const getConfidenceColor = (score: number) => {
    if (score >= 80) return 'bg-emerald-500'
    if (score >= 60) return 'bg-amber-500'
    return 'bg-red-500'
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-mono text-sm flex">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <Terminal size={16} className="text-zinc-500" />
            <span className="text-zinc-400">Multi-Agent ReAct</span>
            {isRunning && (
              <span className="ml-2 text-xs text-zinc-600 animate-pulse">● running</span>
            )}
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 p-4 pb-32 overflow-y-auto">
          {allSteps.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-zinc-600">
              <Terminal size={48} className="mb-4 opacity-20" />
              <p>Enter a task to see the multi-agent system work</p>
            </div>
          ) : (
            <div className="space-y-0">
              {allSteps.map((step, index) => (
                <div key={step.id}>
                  {index > 0 && (
                    <div className="py-1 pl-4">
                      <span className="text-zinc-700">↓</span>
                    </div>
                  )}
                  <div className={`border-l-2 ${getStepStyle(step.type)} pl-4 py-3`}>
                    <div className="flex items-center gap-2 mb-2">
                      {getStepIcon(step.type)}
                      <span className={`text-xs font-semibold uppercase tracking-wider ${
                        step.type === 'review' ? 'text-blue-400' :
                        step.type === 'phase' ? 'text-cyan-400' :
                        step.agent === 'plan' ? 'text-purple-400' :
                        step.agent === 'exec' ? 'text-green-400' :
                        step.type === 'thought' ? 'text-purple-400' :
                        step.type === 'action' ? 'text-amber-400' :
                        step.type === 'observation' ? 'text-emerald-400' :
                        index === 0 ? 'text-blue-400' : 'text-zinc-300'
                      }`}>
                        {index === 0 && step.type === 'final_answer' ? 'User' : getStepLabel(step.type, step.agent)}
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
        <div className="border-t border-zinc-800 bg-zinc-950 p-4">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isRunning ? 'Agents are working...' : 'Enter a task...'}
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

      {/* Agent Collaboration Panel */}
      <div className="w-96 border-l border-zinc-800 bg-zinc-900/30 flex flex-col">
        {/* Phase Indicator */}
        <div className="p-4 border-b border-zinc-800">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Current Phase
          </h3>
          {currentPhase ? (
            <div className="px-3 py-2 bg-cyan-500/10 border border-cyan-500/30 rounded">
              <span className="text-sm text-cyan-400 font-medium">{currentPhase}</span>
            </div>
          ) : (
            <div className="px-3 py-2 bg-zinc-800/50 rounded">
              <span className="text-sm text-zinc-600">Waiting...</span>
            </div>
          )}
        </div>

        {/* Scrollable Panel Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Plan Agent Section */}
          <div>
            <h4 className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Brain size={12} />
              Plan Agent
            </h4>
            <div className="space-y-2">
              {planPanel.steps.length === 0 ? (
                <div className="text-xs text-zinc-600 italic">No activity yet</div>
              ) : (
                planPanel.steps.map(step => (
                  <div key={step.id} className="text-xs">
                    <div className="font-medium text-zinc-500 mb-1">
                      {step.type === 'review' ? 'Review' : 'Thought'}
                    </div>
                    <div className="text-zinc-400 whitespace-pre-wrap leading-relaxed">
                      {step.content.length > 200 ? step.content.slice(0, 200) + '...' : step.content}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Confidence Meter */}
            {planPanel.latestConfidence !== undefined && (
              <div className="mt-3">
                <h4 className="text-xs font-semibold text-zinc-400 mb-1">Confidence Score</h4>
                <div className="w-full bg-zinc-800 rounded-full h-2">
                  <div 
                    className={`h-2 rounded-full ${getConfidenceColor(planPanel.latestConfidence)}`}
                    style={{ width: `${planPanel.latestConfidence}%` }}
                  />
                </div>
                <span className="text-xs text-zinc-500 mt-1">{planPanel.latestConfidence}/100</span>
              </div>
            )}
          </div>

          {/* Exec Agent Section */}
          <div>
            <h4 className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Zap size={12} />
              Exec Agent
            </h4>
            <div className="space-y-2">
              {execPanel.steps.length === 0 ? (
                <div className="text-xs text-zinc-600 italic">No activity yet</div>
              ) : (
                execPanel.steps.map(step => (
                  <div key={step.id} className="text-xs">
                    <div className="font-medium text-zinc-500 mb-1">
                      {step.type === 'observation' ? 'Observation' : 'Thought'}
                    </div>
                    <div className="text-zinc-400 whitespace-pre-wrap leading-relaxed">
                      {step.content.length > 200 ? step.content.slice(0, 200) + '...' : step.content}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}