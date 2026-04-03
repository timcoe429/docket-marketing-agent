import Anthropic from '@anthropic-ai/sdk'

const apiKey = process.env.ANTHROPIC_API_KEY
const anthropic = apiKey ? new Anthropic({ apiKey }) : null

function systemPromptTodayLine() {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  return `Today's date is ${today}.`
}

export const BRAND_CONTEXT = {
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
 * @param {{ title: string, keyword: string, pillar: string } | null | undefined} [plannedTopic]
 * @returns {string | null}
 */
function buildBlogSystemPrompt(brand, plannedTopic) {
  const ctx = BRAND_CONTEXT[brand]
  if (!ctx) return null

  const { brandDescription, audience } = ctx

  const topicBlock = plannedTopic
    ? `TARGET POST (already planned — write exactly this):
Title: ${plannedTopic.title}
Target Keyword: ${plannedTopic.keyword}
Pillar: ${plannedTopic.pillar}

Do not deviate from this topic. Write the best possible post for this exact title and keyword.

Your job is to write a complete, publish-ready blog post for this fixed target keyword. Return the exact target phrase in the JSON "keyword" field (same as Target Keyword above). All placement rules below apply to that keyword.
`
    : `Your job is to write a complete, publish-ready blog post targeting a single target keyword. You MUST choose that keyword from the striking_distance_keywords in the user message (prioritize strong opportunities in positions 4–20). Return the exact same phrase in the JSON "keyword" field. All placement rules below apply to that chosen keyword.
`

  return `${systemPromptTodayLine()}

You are an expert SEO content writer for ${brand}.

${brandDescription}

${topicBlock}
The post must be informative, professional, and written for the target audience: ${audience}.

CONTENT REQUIREMENTS:
- 1,500-2,000 words total
- Written in a professional, informative tone — helpful and authoritative, not salesy
- Naturally work the target keyword into the title, first paragraph, at least 2 H2s, and conclusion
- Include up to 3 internal links to relevant existing pages, but only where they naturally fit and genuinely add value for the reader. Never force a link. Only link when the anchor text is descriptive and the destination page is directly relevant to the surrounding content.
- Every claim should be practical and useful to a business owner in this industry

STRUCTURE REQUIREMENTS — use this exact HTML structure:

1. H1 title (include the target keyword; if a planned title was given, align the H1 with it)
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

/**
 * Strip leading ```json and trailing ``` so JSON.parse can run.
 * @param {string} text
 */
function stripJsonFences(text) {
  const t = String(text).trim()
  return t.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
}

/**
 * @param {{ brand: string, pages: object[], keywords: object[], ga4Pages: object[], plannedTopic?: { title: string, keyword: string, pillar: string } }} ctx
 * @returns {Promise<{ title: string, keyword: string, meta_title: string, meta_description: string, content: string, faq_schema: string } | null>}
 */
export async function generateBlogPostJson(ctx) {
  if (!anthropic) {
    console.warn('claude.generateBlogPostJson: ANTHROPIC_API_KEY not set')
    return null
  }

  const system = buildBlogSystemPrompt(ctx.brand, ctx.plannedTopic)
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

function buildSiteAuditSystemPrompt(brand, brandDescription, pillarsJoined) {
  return `${systemPromptTodayLine()}

You are an expert SEO strategist analyzing the complete content landscape for ${brand}.

${brandDescription}

Your pillars are: ${pillarsJoined}

You have been given:
- Complete list of existing pages (URL, title, headings)
- Full GSC keyword data (keywords, positions, clicks, impressions)
- GA4 traffic data (pages, sessions, conversions)

Your job is to produce a complete content intelligence report. Return ONLY raw JSON with no markdown formatting, no code fences, no backticks. Start your response with { and end with }. Use these exact fields:

{
  "summary": "2-3 sentence executive summary of the site's current content health and biggest opportunities",
  
  "pillar_map": {
    "Pillar Name": {
      "description": "what this pillar covers",
      "existing_posts": ["url1", "url2"],
      "health": "strong/developing/weak",
      "gaps": ["topic gap 1", "topic gap 2"]
    }
  },
  
  "content_gaps": [
    {
      "keyword": "target keyword",
      "monthly_searches": "estimated volume",
      "pillar": "which pillar this belongs to",
      "type": "pillar/supporting",
      "reasoning": "why this gap matters"
    }
  ],
  
  "action_items": [
    {
      "action_type": "prune/combine/update/redirect",
      "affected_urls": ["url1", "url2"],
      "recommendation": "specific action to take",
      "reasoning": "detailed explanation of why",
      "seo_impact": "high/medium/low",
      "estimated_benefit": "what improvement to expect"
    }
  ],
  
  "content_plan": [
    {
      "priority": 1,
      "title": "suggested post title",
      "keyword": "target keyword",
      "type": "pillar/supporting",
      "pillar": "which pillar",
      "reasoning": "why this should be written now",
      "estimated_impact": "high/medium/low"
    }
  ]
}

IMPORTANT RULES:
- content_plan must have exactly 12 items in priority order
- action_items should be specific and actionable with clear URLs
- For prune recommendations: explain exactly why (thin content, duplicate, no traffic, cannibalization)
- For combine recommendations: list all URLs to combine and what the new definitive post should cover
- For update recommendations: explain what's missing or outdated
- pillar_map must cover ALL defined pillars even if some have no existing content
- content_gaps should focus on keywords with real search volume not already covered
- Do NOT recommend writing posts that already exist on the site`
}

const MAX_SITE_AUDIT_PAGES = 150

function normalizePathForTrafficMatch(path) {
  if (typeof path !== 'string') return ''
  let p = path.trim()
  if (!p.startsWith('/')) p = `/${p}`
  p = p.split('?')[0].replace(/\/+$/, '')
  return (p || '/').toLowerCase()
}

/**
 * @param {Array<{ page?: string, sessions?: number }>} ga4Pages
 * @returns {Map<string, number>}
 */
function buildPathSessionsMap(ga4Pages) {
  const m = new Map()
  for (const row of ga4Pages || []) {
    const path = row?.page
    if (typeof path !== 'string' || !path.trim()) continue
    const key = normalizePathForTrafficMatch(path)
    const s = Number(row.sessions) || 0
    m.set(key, Math.max(m.get(key) || 0, s))
  }
  return m
}

/**
 * @param {string} pageUrl
 * @param {Map<string, number>} pathSessions
 */
function sessionsForCrawledPageUrl(pageUrl, pathSessions) {
  try {
    const u = new URL(pageUrl)
    const key = normalizePathForTrafficMatch(u.pathname)
    return pathSessions.get(key) ?? 0
  } catch {
    return 0
  }
}

/**
 * Highest GA4 sessions first (path matched to crawled URL pathname), max 150 pages.
 * @param {object[]} pages — crawl rows with `url`
 * @param {object[]} ga4Pages
 */
function capPagesForSiteAudit(pages, ga4Pages) {
  if (!Array.isArray(pages) || pages.length === 0) return []
  const pathSessions = buildPathSessionsMap(ga4Pages)
  if (pathSessions.size === 0) {
    return pages.slice(0, MAX_SITE_AUDIT_PAGES)
  }
  return [...pages]
    .sort(
      (a, b) =>
        sessionsForCrawledPageUrl(String(b?.url ?? ''), pathSessions) -
        sessionsForCrawledPageUrl(String(a?.url ?? ''), pathSessions)
    )
    .slice(0, MAX_SITE_AUDIT_PAGES)
}

/**
 * @param {{
 *   brand: string,
 *   brandDescription: string,
 *   pillarNames: string[],
 *   pages: object[],
 *   gscKeywords: object[],
 *   ga4Pages: object[],
 *   gscNote?: string,
 *   ga4Note?: string
 * }} ctx
 */
export async function generateSiteAuditJson(ctx) {
  if (!anthropic) {
    console.warn('claude.generateSiteAuditJson: ANTHROPIC_API_KEY not set')
    return null
  }

  const pillarsJoined = ctx.pillarNames.join(', ')
  const system = buildSiteAuditSystemPrompt(
    ctx.brand,
    ctx.brandDescription,
    pillarsJoined
  )

  const pagesForAudit = capPagesForSiteAudit(ctx.pages, ctx.ga4Pages)

  const payload = {
    existing_pages: pagesForAudit,
    gsc_keywords: ctx.gscKeywords,
    top_ga4_pages: ctx.ga4Pages,
    data_notes: {
      gsc: ctx.gscNote ?? null,
      ga4: ctx.ga4Note ?? null
    }
  }

  const user = `Brand: ${ctx.brand}

Use the following data (JSON). If gsc_keywords or top_ga4_pages are empty, or data_notes indicate a source failed, still complete the report and briefly mention limitations in the summary.

${JSON.stringify(payload, null, 2)}

Respond with a single JSON object only.`

  const SITE_AUDIT_MAX_TOKENS = 16000
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: SITE_AUDIT_MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: user }]
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  if (message.stop_reason === 'max_tokens') {
    console.warn(
      'claude.generateSiteAuditJson: stop_reason=max_tokens — output may be truncated; invalid JSON is likely'
    )
  }

  let parsed
  try {
    const jsonText = stripJsonFences(text)
    parsed = JSON.parse(jsonText)
  } catch (err) {
    const preview = text.slice(0, 500)
    console.error(
      'claude.generateSiteAuditJson: invalid JSON from model:',
      err instanceof Error ? err.message : err
    )
    console.error(
      'claude.generateSiteAuditJson: raw response preview (first 500 chars):',
      preview
    )
    return null
  }

  if (
    !parsed ||
    typeof parsed.summary !== 'string' ||
    typeof parsed.pillar_map !== 'object' ||
    parsed.pillar_map === null ||
    !Array.isArray(parsed.content_gaps) ||
    !Array.isArray(parsed.action_items) ||
    !Array.isArray(parsed.content_plan)
  ) {
    console.error('claude.generateSiteAuditJson: missing required keys or wrong types')
    return null
  }

  if (parsed.content_plan.length !== 12) {
    console.error(
      'claude.generateSiteAuditJson: content_plan must have exactly 12 items, got',
      parsed.content_plan.length
    )
    return null
  }

  return {
    summary: parsed.summary,
    pillar_map: parsed.pillar_map,
    content_gaps: parsed.content_gaps,
    action_items: parsed.action_items,
    content_plan: parsed.content_plan
  }
}

const CRO_ANALYSIS_TOOLS = [
  { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }
]

const CRO_ANALYSIS_SYSTEM = `You are an expert CRO (Conversion Rate Optimization) specialist analyzing pages for Docket — dumpster rental, junk removal, and commercial/residential waste software.

The only conversion that matters is generate_lead (demo request form submissions).

You have been given:
- Conversion rate data by device for this page (current 14 days vs previous 14 days)
- Screenshots of the page on mobile and desktop

Your job is to identify the SINGLE most impactful thing to test on this page. Keep it simple and specific — not a full redesign, just one element.

Return ONLY valid JSON:
{
  "page": "/page-path/",
  "observation": "What you see in the data and/or screenshots that indicates a problem",
  "hypothesis": "If we change X, conversion rate will improve because Y",
  "what_to_test": "Specific element and change — e.g. Change CTA button text from 'Schedule a Demo' to 'See Docket in Action'",
  "device_focus": "mobile/desktop/both",
  "priority": "high/medium/low",
  "reasoning": "Why this is the highest priority test right now"
}`

function extractAssistantTextBlocks(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

/**
 * Per-page CRO recommendation: metrics JSON + optional PNG screenshots, web search enabled.
 * @param {{
 *   pagePath: string,
 *   pageName: string,
 *   metricsJson: object,
 *   mobileBase64?: string | null,
 *   desktopBase64?: string | null
 * }} args
 * @returns {Promise<{
 *   page: string,
 *   observation: string,
 *   hypothesis: string,
 *   what_to_test: string,
 *   device_focus: string,
 *   priority: string,
 *   reasoning: string
 * } | null>}
 */
export async function analyzeCROPageJson({
  pagePath,
  pageName,
  metricsJson,
  mobileBase64,
  desktopBase64
}) {
  if (!anthropic) {
    console.warn('claude.analyzeCROPageJson: ANTHROPIC_API_KEY not set')
    return null
  }

  let textIntro = `Page: ${pagePath}
Page name: ${pageName}

Conversion rate data (JSON):
${JSON.stringify(metricsJson, null, 2)}

`
  if (!mobileBase64) {
    textIntro += 'Mobile screenshot: not available (capture failed).\n'
  } else {
    textIntro += 'Mobile screenshot: attached as first image.\n'
  }
  if (!desktopBase64) {
    textIntro += 'Desktop screenshot: not available (capture failed).\n'
  } else {
    textIntro += 'Desktop screenshot: attached as second image (when mobile is present).\n'
  }
  textIntro +=
    'Use web search if helpful for current CRO best practices. Return ONLY the JSON object specified in the system prompt — no markdown, no code fences.'

  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: textIntro },
        ...(mobileBase64
          ? [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: mobileBase64
                }
              }
            ]
          : []),
        ...(desktopBase64
          ? [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: desktopBase64
                }
              }
            ]
          : [])
      ]
    }
  ]

  let lastText = ''
  const maxTurns = 8

  for (let turn = 0; turn < maxTurns; turn++) {
    let msg
    try {
      msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: CRO_ANALYSIS_SYSTEM,
        messages,
        tools: CRO_ANALYSIS_TOOLS
      })
    } catch (err) {
      console.error(
        'claude.analyzeCROPageJson: API error:',
        err instanceof Error ? err.message : err
      )
      return null
    }

    messages.push({ role: 'assistant', content: msg.content })
    const chunk = extractAssistantTextBlocks(msg.content)
    if (chunk) lastText = chunk

    if (msg.stop_reason === 'end_turn' || msg.stop_reason === 'max_tokens') {
      break
    }
    if (msg.stop_reason === 'pause_turn') {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Continue and finish with the single JSON object only.'
          }
        ]
      })
      continue
    }
    break
  }

  if (!lastText) {
    console.error('claude.analyzeCROPageJson: empty model text')
    return null
  }

  let parsed
  try {
    parsed = JSON.parse(stripJsonFences(lastText))
  } catch {
    console.error('claude.analyzeCROPageJson: invalid JSON from model')
    return null
  }

  const ok =
    parsed &&
    typeof parsed.page === 'string' &&
    typeof parsed.observation === 'string' &&
    typeof parsed.hypothesis === 'string' &&
    typeof parsed.what_to_test === 'string' &&
    typeof parsed.device_focus === 'string' &&
    typeof parsed.priority === 'string' &&
    typeof parsed.reasoning === 'string'

  if (!ok) {
    console.error('claude.analyzeCROPageJson: missing required keys')
    return null
  }

  return {
    page: parsed.page,
    observation: parsed.observation,
    hypothesis: parsed.hypothesis,
    what_to_test: parsed.what_to_test,
    device_focus: parsed.device_focus,
    priority: parsed.priority,
    reasoning: parsed.reasoning
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
