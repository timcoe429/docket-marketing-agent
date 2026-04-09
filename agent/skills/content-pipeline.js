import axios from 'axios'
import * as cheerio from 'cheerio'
import { parseStringPromise } from 'xml2js'
import * as base44 from '../lib/base44.js'
import { generateBlogPostJson } from '../lib/claude.js'
import { getGA4Data, getGSCData } from '../lib/google.js'

export const BRANDS = {
  Docket: {
    gscSite: 'https://www.yourdocket.com/',
    ga4PropertyId: '178229582',
    sitemap: 'https://www.yourdocket.com/post-sitemap.xml',
    wpUrl: 'https://www.yourdocket.com',
    wpUser: 'marketing-agent',
    wpPassword: process.env.WP_PASSWORD_DOCKET
  },
  ServiceCore: {
    gscSite: 'https://servicecore.com/',
    ga4PropertyId: '321097999',
    sitemap: 'https://servicecore.com/post-sitemap.xml',
    wpUrl: 'https://servicecore.com',
    wpUser: 'marketing-agent',
    wpPassword: process.env.WP_PASSWORD_SERVICECORE
  }
}

const MAX_PAGES = 500
const HTML_CONCURRENCY = 4
const HTTP_HEADERS = { 'User-Agent': 'DocketMarketingAgent/1.0' }

function agentNameFor(brand) {
  return `content-agent-${brand.toLowerCase()}`
}

/** xml2js may return a single child as an object or repeated children as an array */
function toArray(x) {
  if (x == null) return []
  return Array.isArray(x) ? x : [x]
}

function normalizeLoc(loc) {
  if (loc == null) return ''
  if (Array.isArray(loc)) {
    const first = loc[0]
    return first != null ? String(first).trim() : ''
  }
  return String(loc).trim()
}

function parseSitemapDocument(parsed) {
  const pageUrls = []
  const childSitemaps = []
  for (const urlset of toArray(parsed.urlset)) {
    for (const u of toArray(urlset.url)) {
      const loc = normalizeLoc(u.loc)
      if (loc) pageUrls.push(loc)
    }
  }
  for (const idx of toArray(parsed.sitemapindex)) {
    for (const s of toArray(idx.sitemap)) {
      const loc = normalizeLoc(s.loc)
      if (loc) childSitemaps.push(loc)
    }
  }
  return { pageUrls, childSitemaps }
}

async function fetchXml(url) {
  const { data, status } = await axios.get(url, {
    responseType: 'text',
    timeout: 25000,
    headers: HTTP_HEADERS,
    validateStatus: (s) => s >= 200 && s < 300
  })
  if (status !== 200 || typeof data !== 'string') {
    throw new Error(`Sitemap fetch failed (${status}): ${url}`)
  }
  return data
}

/**
 * Walk sitemap index(es) and collect up to maxUrls page locs.
 */
export async function collectPageUrlsFromSitemaps(startUrl, maxUrls) {
  const queue = [startUrl]
  const seenSitemaps = new Set()
  const pageUrls = []

  while (queue.length > 0 && pageUrls.length < maxUrls) {
    const sitemapUrl = queue.shift()
    if (!sitemapUrl || seenSitemaps.has(sitemapUrl)) continue
    seenSitemaps.add(sitemapUrl)

    const xml = await fetchXml(sitemapUrl)
    const parsed = await parseStringPromise(xml, {
      explicitArray: false,
      trim: true
    })
    const { pageUrls: direct, childSitemaps } = parseSitemapDocument(parsed)

    for (const p of direct) {
      if (pageUrls.length >= maxUrls) break
      pageUrls.push(p)
    }
    for (const c of childSitemaps) {
      if (!seenSitemaps.has(c)) queue.push(c)
    }
  }

  return pageUrls.slice(0, maxUrls)
}

function extractPageMeta(html, url) {
  const $ = cheerio.load(html)
  const title = $('title').first().text().trim() || ''
  const description =
    $('meta[name="description"]').attr('content')?.trim() || ''
  const headings = []
  $('h1, h2, h3').each((_, el) => {
    const tag =
      el.type === 'tag' && el.name ? String(el.name).toLowerCase() : ''
    const level = tag === 'h1' ? 1 : tag === 'h2' ? 2 : 3
    const text = $(el).text().trim()
    if (text) headings.push({ level, text })
  })
  return { url, title, description, headings }
}

async function fetchHtmlPage(url) {
  try {
    const { data, status } = await axios.get(url, {
      responseType: 'text',
      timeout: 25000,
      headers: HTTP_HEADERS,
      validateStatus: (s) => s >= 200 && s < 300
    })
    if (status !== 200 || typeof data !== 'string') {
      return { url, title: '', description: '', headings: [] }
    }
    return extractPageMeta(data, url)
  } catch {
    return { url, title: '', description: '', headings: [] }
  }
}

async function runPool(urls, limit, worker) {
  const results = new Array(urls.length)
  let next = 0
  async function runWorker() {
    while (true) {
      const i = next++
      if (i >= urls.length) break
      results[i] = await worker(urls[i], i)
    }
  }
  const n = Math.min(limit, urls.length) || 1
  await Promise.all(Array.from({ length: n }, () => runWorker()))
  return results
}

/**
 * @returns {Promise<Array<{ url: string, title: string, description: string, headings: { level: number, text: string }[] }>>}
 */
export async function crawlPagesFromSitemap(sitemapIndexUrl) {
  const urls = await collectPageUrlsFromSitemaps(sitemapIndexUrl, MAX_PAGES)
  const rows = await runPool(urls, HTML_CONCURRENCY, (u) => fetchHtmlPage(u))
  return rows.filter((r) => r.title || r.headings.length > 0 || r.description)
}

export async function runForBrand(brand) {
  const agent = agentNameFor(brand)
  const cfg = BRANDS[brand]
  if (!cfg) {
    await base44.log(agent, brand, 'error', `Unknown brand: ${brand}`)
    return
  }

  try {
    await base44.log(agent, brand, 'info', `Starting pipeline for ${brand}`)

    let pages
    try {
      pages = await crawlPagesFromSitemap(cfg.sitemap)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await base44.log(agent, brand, 'error', msg)
      return
    }

    await base44.log(
      agent,
      brand,
      'info',
      `Crawled ${pages.length} pages from sitemap`
    )

    if (pages.length === 0) {
      await base44.log(
        agent,
        brand,
        'error',
        'No pages crawled from sitemap; aborting pipeline'
      )
      return
    }

    let gsc = []
    try {
      gsc = await getGSCData(cfg.gscSite)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await base44.log(agent, brand, 'error', `GSC: ${msg}`)
    }
    await base44.log(
      agent,
      brand,
      'info',
      `Found ${gsc.length} striking distance keywords`
    )

    let ga4 = []
    try {
      ga4 = await getGA4Data(cfg.ga4PropertyId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await base44.log(agent, brand, 'error', `GA4: ${msg}`)
    }
    await base44.log(
      agent,
      brand,
      'info',
      `Pulled top ${ga4.length} pages from GA4`
    )

    const plannedRow = await base44.getTopPlannedPost(brand)
    const plannedId =
      plannedRow && typeof plannedRow === 'object'
        ? plannedRow.id ?? plannedRow._id ?? plannedRow.entityId ?? null
        : null

    let plannedTopic = null
    if (plannedId != null && plannedRow) {
      const t = plannedRow.title
      const k = plannedRow.keyword
      const p = plannedRow.pillar
      if (
        typeof t === 'string' &&
        t.trim() &&
        typeof k === 'string' &&
        k.trim()
      ) {
        plannedTopic = {
          title: t.trim(),
          keyword: k.trim(),
          pillar: typeof p === 'string' && p.trim() ? p.trim() : ''
        }
      }
    }

    if (plannedTopic) {
      const w = await base44.updatePlannedPost(plannedId, { status: 'writing' })
      if (!w) {
        await base44.log(
          agent,
          brand,
          'error',
          'updatePlannedPost(writing) failed; continuing with generation'
        )
      }
    } else {
      await base44.log(
        agent,
        brand,
        'info',
        'No planned posts found, falling back to autonomous topic selection'
      )
    }

    const post = await generateBlogPostJson({
      brand,
      pages,
      keywords: gsc,
      ga4Pages: ga4,
      ...(plannedTopic ? { plannedTopic } : {})
    })
    if (!post) {
      if (plannedTopic && plannedId != null) {
        await base44.updatePlannedPost(plannedId, { status: 'planned' })
      }
      await base44.log(
        agent,
        brand,
        'error',
        'Claude did not return a valid blog post'
      )
      return
    }

    await base44.log(
      agent,
      brand,
      'info',
      `Claude selected topic: ${post.keyword}`
    )

    const created = await base44.createBlogPost({
      title: post.title,
      brand,
      keyword: post.keyword,
      content: post.content,
      meta_title: post.meta_title,
      meta_description: post.meta_description,
      faq_schema: post.faq_schema,
      status: 'pending_review'
    })
    if (!created) {
      if (plannedTopic && plannedId != null) {
        await base44.updatePlannedPost(plannedId, { status: 'planned' })
      }
      await base44.log(agent, brand, 'error', 'createBlogPost failed')
      return
    }

    if (plannedTopic && plannedId != null) {
      const u = await base44.updatePlannedPost(plannedId, { status: 'written' })
      if (!u) {
        await base44.log(
          agent,
          brand,
          'error',
          'updatePlannedPost(written) failed after BlogPost create'
        )
      }
    }

    await base44.log(
      agent,
      brand,
      'success',
      `Blog post created: ${post.title}`
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await base44.log(agent, brand, 'error', msg)
  }
}

/**
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function publishToWordPress(blogPostId, brand) {
  const agent = agentNameFor(brand)
  const cfg = BRANDS[brand]
  if (!cfg) {
    await base44.log(
      agent,
      brand,
      'error',
      `publishToWordPress: unknown brand ${brand}`
    )
    return { ok: false, error: 'Unknown brand' }
  }

  if (!cfg.wpPassword) {
    await base44.log(
      agent,
      brand,
      'error',
      'WordPress application password not configured for this brand'
    )
    return { ok: false, error: 'Missing WP password' }
  }

  const post = await base44.getBlogPost(blogPostId)
  if (!post) {
    await base44.log(
      agent,
      brand,
      'error',
      `BlogPost not found: ${blogPostId}`
    )
    return { ok: false, error: 'BlogPost not found' }
  }

  const title = post.title
  const content = post.content
  if (!content || typeof content !== 'string') {
    await base44.log(agent, brand, 'error', 'BlogPost has no content')
    return { ok: false, error: 'Missing content' }
  }

  const base = cfg.wpUrl.replace(/\/$/, '')
  const auth = Buffer.from(`${cfg.wpUser}:${cfg.wpPassword}`).toString(
    'base64'
  )

  try {
    const { data } = await axios.post(
      `${base}/wp-json/wp/v2/posts`,
      {
        title,
        content,
        status: 'draft',
        meta: {
          _yoast_wpseo_title: post.meta_title || '',
          _yoast_wpseo_metadesc: post.meta_description || '',
          _yoast_wpseo_focuskw: post.keyword || ''
        }
      },
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    )
    const id = data?.id
    if (id == null) {
      throw new Error('WordPress response missing post id')
    }
    const wpDraftUrl = `${base}/wp-admin/post.php?post=${id}&action=edit`
    const updated = await base44.updateBlogPost(blogPostId, {
      wp_draft_url: wpDraftUrl,
      status: 'published'
    })
    if (!updated) {
      await base44.log(
        agent,
        brand,
        'error',
        'WordPress draft created but Base44 update failed'
      )
      return { ok: false, error: 'Base44 update failed' }
    }
    await base44.log(
      agent,
      brand,
      'success',
      `WordPress draft created: ${wpDraftUrl}`
    )
    return { ok: true }
  } catch (err) {
    const data = err.response?.data
    const msg =
      (typeof data?.message === 'string' && data.message) ||
      (typeof data === 'string' && data) ||
      err.message
    await base44.log(
      agent,
      brand,
      'error',
      `WordPress publish failed: ${msg}`
    )
    return { ok: false, error: String(msg) }
  }
}

/** Same shape handling as base44.normalizeList (not exported from base44). */
function normalizeBlogPostListResponse(data) {
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.data)) return data.data
  if (data && Array.isArray(data.items)) return data.items
  if (data && Array.isArray(data.records)) return data.records
  if (data && Array.isArray(data.results)) return data.results
  return []
}

const POLL_AGENT = 'content-agent-poll'

/**
 * Poll Base44 for BlogPost rows with status approved and push each to WordPress as draft.
 * Silent when none approved. List fetch errors go to console only.
 */
export async function publishApprovedPosts() {
  const baseUrl = process.env.BASE44_API_BASE_URL || 'https://app.base44.com'
  const appId = process.env.BASE44_APP_ID || '69c933514906e97b30004421'
  const listUrl = `${baseUrl.replace(/\/$/, '')}/api/apps/${appId}/entities/BlogPost`

  let raw
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (process.env.BASE44_API_KEY) {
      headers.api_key = process.env.BASE44_API_KEY
    }
    const { data } = await axios.get(listUrl, { headers, timeout: 60000 })
    raw = data
  } catch (err) {
    console.error(
      'publishApprovedPosts: Base44 list failed:',
      err.response?.data ?? err.message
    )
    return
  }

  const approved = normalizeBlogPostListResponse(raw).filter(
    (row) =>
      row && String(row.status || '').toLowerCase() === 'approved'
  )
  if (approved.length === 0) return

  for (const row of approved) {
    const id = row.id ?? row._id ?? row.entityId
    if (id == null || id === '') {
      await base44.log(
        POLL_AGENT,
        'System',
        'error',
        'publishApprovedPosts: approved BlogPost row has no id, skip'
      )
      continue
    }
    const brand = row.brand
    if (!brand || !BRANDS[brand]) {
      await base44.log(
        POLL_AGENT,
        String(brand ?? 'unknown'),
        'error',
        `publishApprovedPosts: unknown or missing brand for BlogPost ${id}, skip`
      )
      continue
    }
    await publishToWordPress(String(id), brand)
  }
}
