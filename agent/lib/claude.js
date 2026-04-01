import Anthropic from '@anthropic-ai/sdk'

const apiKey = process.env.ANTHROPIC_API_KEY
const anthropic = apiKey ? new Anthropic({ apiKey }) : null

const BRAND_CONTEXT = {
  Docket: {
    brandDescription:
      'Docket is the leading software platform built for dumpster rental, junk hauling, and commercial/residential trash businesses. It handles scheduling, dispatch, driver management, billing, customer communication, and online booking — everything a waste hauling business needs in one platform.',
    audience:
      'dumpster rental, junk hauling, and trash collection business owners'
  },
  ServiceCore: {
    brandDescription:
      'ServiceCore is the #1 software for portable toilet, septic, and grease trap businesses. It helps operators manage routes, track inventory, dispatch drivers, automate billing, and grow their business. Built specifically for the portable sanitation and liquid waste industry.',
    audience: 'portable toilet, septic, and grease trap business owners'
  }
}

/**
 * @param {string} brand
 * @returns {string | null}
 */
function buildBlogSystemPrompt(brand) {
  const ctx = BRAND_CONTEXT[brand]
  if (!ctx) return null

  const { brandDescription, audience } = ctx

  return `You are an expert SEO content writer for ${brand}.

${brandDescription}

Your job is to write a complete, publish-ready blog post targeting a single target keyword. You MUST choose that keyword from the striking_distance_keywords in the user message (prioritize strong opportunities in positions 4–20). Return the exact same phrase in the JSON "keyword" field. All placement rules below apply to that chosen keyword.

The post must be informative, professional, and written for the target audience: ${audience}.

CONTENT REQUIREMENTS:
- 1,500-2,000 words total
- Written in a professional, informative tone — helpful and authoritative, not salesy
- Naturally work your chosen target keyword into the title, first paragraph, at least 2 H2s, and conclusion
- Include at least 3 internal links to relevant existing pages (use real URLs from the site data provided)
- Every claim should be practical and useful to a business owner in this industry

STRUCTURE REQUIREMENTS — use this exact HTML structure:

1. H1 title (include target keyword)
2. Opening paragraph — 2-3 sentences establishing what the article covers and why it matters
3. Key Takeaways box — HTML aside element with 4-5 bullet points summarizing the article
4. 5 body sections each with an H2 heading and 200-300 words of content
5. FAQ section — minimum 4 questions relevant to the topic, each as H3
6. Closing paragraph — 2-3 sentences wrapping up with a soft CTA to learn more about ${brand}

SCHEMA REQUIREMENTS:
Wrap the FAQ section in proper FAQ schema JSON-LD. Return it as a separate field in your JSON response (faq_schema): a single string containing a full HTML script tag, e.g. <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[...]}</script>. The mainEntity entries must match the FAQ questions and answers in the content.

SEO REQUIREMENTS:
- Meta title: 50-60 characters, include keyword
- Meta description: 150-160 characters, include keyword, compelling reason to click
- The target keyword should appear in: H1, first 100 words, at least 2 H2s, meta title, meta description

HTML REQUIREMENTS:
- Return clean semantic HTML for the content field
- Use <h1>, <h2>, <h3>, <p>, <ul>, <li>, <aside>, <strong> tags appropriately
- Key Takeaways: <aside class="key-takeaways"><h2>Key Takeaways</h2><ul>...</ul></aside>
- Internal links: <a href="URL">anchor text</a> — use descriptive anchor text with keywords
- FAQ section: wrap each Q&A in <div class="faq-item"><h3>Question</h3><p>Answer</p></div>
- Wrap entire FAQ in <section class="faq-section"><h2>Frequently Asked Questions</h2>...</section>

Return ONLY valid JSON with these exact fields:
{
  "title": "...",
  "keyword": "...",
  "meta_title": "...",
  "meta_description": "...",
  "content": "...full HTML...",
  "faq_schema": "...JSON-LD script tag as a string..."
}`
}

function stripJsonFences(text) {
  let t = text.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t)
  if (fence) t = fence[1].trim()
  return t
}

/**
 * @param {{ brand: string, pages: object[], keywords: object[], ga4Pages: object[] }} ctx
 * @returns {Promise<{ title: string, keyword: string, meta_title: string, meta_description: string, content: string, faq_schema: string } | null>}
 */
export async function generateBlogPostJson(ctx) {
  if (!anthropic) {
    console.warn('claude.generateBlogPostJson: ANTHROPIC_API_KEY not set')
    return null
  }

  const system = buildBlogSystemPrompt(ctx.brand)
  if (!system) {
    console.error(
      'claude.generateBlogPostJson: unknown brand (expected Docket or ServiceCore):',
      ctx.brand
    )
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
    max_tokens: 8192,
    system,
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
    typeof parsed.meta_title !== 'string' ||
    typeof parsed.meta_description !== 'string' ||
    typeof parsed.content !== 'string' ||
    typeof parsed.faq_schema !== 'string'
  ) {
    console.error('claude.generateBlogPostJson: missing required keys')
    return null
  }

  if (!parsed.meta_title.trim() || !parsed.faq_schema.trim()) {
    console.error('claude.generateBlogPostJson: empty meta_title or faq_schema')
    return null
  }

  return {
    title: parsed.title,
    keyword: parsed.keyword,
    meta_title: parsed.meta_title,
    meta_description: parsed.meta_description,
    content: parsed.content,
    faq_schema: parsed.faq_schema
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
