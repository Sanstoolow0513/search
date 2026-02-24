export const config = {
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet',
  },
  tavily: {
    apiKey: process.env.TAVILY_API_KEY || '',
    baseUrl: 'https://api.tavily.com',
  },
  project: {
    rootDir: process.cwd(),
    maxFileSize: 1024 * 1024,
  },
} as const
