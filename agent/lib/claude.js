import Anthropic from '@anthropic-ai/sdk'

const apiKey = process.env.ANTHROPIC_API_KEY
const anthropic = apiKey ? new Anthropic({ apiKey }) : null

export async function ask(prompt, system = 'You are a marketing operations agent.') {
  if (!anthropic) {
    console.warn('claude.ask: ANTHROPIC_API_KEY not set')
    return ''
  }
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: prompt }]
  })
  return message.content[0].text
}
