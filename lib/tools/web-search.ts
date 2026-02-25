import { config } from '../config'
import { Tool } from '../agent/types'

interface TavilySearchResult {
  title: string
  url: string
  content: string
  score: number
}

interface TavilyResponse {
  results: TavilySearchResult[]
  answer?: string
}

// Track search history to prevent duplicate queries
const searchHistory: Set<string> = new Set()

export function clearSearchHistory(): void {
  searchHistory.clear()
}

export function getSearchHistory(): string[] {
  return Array.from(searchHistory)
}

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web for current information. Returns TOP 3 most relevant results with summaries. Avoid searching for similar queries repeatedly.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Concise search query with keywords only. Remove filler words. Example: "Next.js 14 app router middleware auth"',
      },
    },
    required: ['query'],
  },
  execute: async (params: Record<string, unknown>): Promise<string> => {
    const query = params.query as string

    if (!query || typeof query !== 'string') {
      return 'Error: Invalid query parameter'
    }

    // Check for duplicate/similar searches
    const normalizedQuery = query.toLowerCase().replace(/\s+/g, ' ').trim()
    for (const pastQuery of searchHistory) {
      const similarity = calculateSimilarity(normalizedQuery, pastQuery)
      if (similarity > 0.8) {
        return `Note: Similar search already performed ("${pastQuery}"). Current query: "${query}". Consider refining your search strategy or using existing results.`
      }
    }
    searchHistory.add(normalizedQuery)

    try {
      const response = await fetch(`${config.tavily.baseUrl}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.tavily.apiKey}`,
        },
        body: JSON.stringify({
          query,
          search_depth: 'advanced',
          max_results: 5,
          include_answer: true,
        }),
      })

      if (!response.ok) {
        return `Error: Tavily API returned ${response.status}`
      }

      const data: TavilyResponse = await response.json()

      if (!data.results || data.results.length === 0) {
        return 'No results found. Try: (1) Using different keywords (2) Removing specific terms (3) Searching in English'
      }

      // Sort by relevance score and take top 3
      const topResults = data.results
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)

      let result = `Search: "${query}"\n`
      result += `Results: ${data.results.length} found, showing top ${topResults.length}\n\n`

      if (data.answer) {
        result += `Quick Answer: ${data.answer}\n\n`
      }

      result += '--- Top Results ---\n'

      topResults.forEach((r, i) => {
        const relevance = r.score > 0.8 ? 'High' : r.score > 0.5 ? 'Medium' : 'Low'
        result += `\n[${i + 1}] ${r.title}\n`
        result += `    Source: ${r.url}\n`
        result += `    Relevance: ${relevance} (${(r.score * 100).toFixed(0)}%)\n`
        // Limit content length to prevent overwhelming the LLM
        const content = r.content.slice(0, 150)
        result += `    Summary: ${content}${r.content.length > 150 ? '...' : ''}\n`
      })

      result += '\n--- Analysis Guide ---\n'
      result += 'After reading these results:\n'
      result += '1. State whether the results answer your question [Relevant/Partial/Irrelevant]\n'
      result += '2. If [Partial], identify what specific info is missing\n'
      result += '3. If [Irrelevant], explain why and plan a new search strategy\n'

      return result
    } catch (error) {
      return `Error performing search: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  },
}

// Simple string similarity calculation (Jaccard similarity)
function calculateSimilarity(str1: string, str2: string): number {
  const set1 = new Set(str1.split(' '))
  const set2 = new Set(str2.split(' '))

  const intersection = new Set([...set1].filter(x => set2.has(x)))
  const union = new Set([...set1, ...set2])

  return intersection.size / union.size
}
