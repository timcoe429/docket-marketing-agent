import Anthropic from '@anthropic-ai/sdk'

const apiKey = process.env.ANTHROPIC_API_KEY
const anthropic = apiKey ? new Anthropic({ apiKey }) : null

const BLOG_SYSTEM = (brand) => `You are an expert SEO content strategist and blog writer for ${brand}.
Your job is to identify the single best content opportunity and write a complete,
publish-ready blog post that will rank well in Google.

You have access to:
- The site's existing content (to avoid duplication and add internal links)
- Keywords in striking distance (positions 4-20) — prioritize these
- Top performing pages — use these for internal linking

Write a complete blog post in HTML format (just the body content, no <html>/<head> tags).
Include:
- A compelling H1 title
- Proper H2/H3 structure
- At least 3 internal links to existing pages (use real URLs from the sitemap data)
- Target keyword naturally throughout
- 1200-1800 words
- A meta description (return separately)

Return your response as JSON only (no markdown fences), with this exact shape:
{
  "title": "...",
  "keyword": "...",
  "meta_description": "...",
  "content": "...full HTML content..."
}`

function stripJsonFences(text) {
  let t = text.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t)
  if (fence) t = fence[1].trim()
  return t
}

/**
 * @param {{ brand: string, pages: object[], keywords: object[], ga4Pages: object[] }} ctx
 * @returns {Promise<{ title: string, keyword: string, meta_description: string, content: string } | null>}
 */
export async function generateBlogPostJson(ctx) {
  if (!anthropic) {
    console.warn('claude.generateBlogPostJson: ANTHROPIC_API_KEY not set')
    return null
  }

  const payload = {
    existing_pages: ctx.pages,
    striking_distance_keywords: ctx.keywords,
    top_ga4_pages: ctx.ga4Pages
  }

  const user = `Brand: ${ctx.brand}

Use the following data (JSON):

${JSON.stringify(payload, null, 2)}

Respond with a single JSON object only.`

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: BLOG_SYSTEM(ctx.brand),
    messages: [{ role: 'user', content: user }]
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  let parsed
  try {
    parsed = JSON.parse(stripJsonFences(text))
  } catch {
    console.error('claude.generateBlogPostJson: invalid JSON from model')
    return null
  }

  if (
    !parsed ||
    typeof parsed.title !== 'string' ||
    typeof parsed.keyword !== 'string' ||
    typeof parsed.meta_description !== 'string' ||
    typeof parsed.content !== 'string'
  ) {
    console.error('claude.generateBlogPostJson: missing required keys')
    return null
  }

  return {
    title: parsed.title,
    keyword: parsed.keyword,
    meta_description: parsed.meta_description,
    content: parsed.content
  }
}

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
