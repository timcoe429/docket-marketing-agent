import * as base44 from '../lib/base44.js'
import {
  BRAND_CONTEXT,
  generateSiteAuditJson
} from '../lib/claude.js'
import { getGA4Data, getGSCAuditData } from '../lib/google.js'
import { PILLARS } from '../config/pillars.js'
import { BRANDS, crawlPagesFromSitemap } from './content-pipeline.js'

function agentNameFor(brand) {
  return `content-agent-${brand.toLowerCase()}`
}

function auditDateIso() {
  return new Date().toISOString().slice(0, 10)
}

/** @param {{ keyword?: string } | null | undefined} row */
function gscKeywordKey(row) {
  if (!row || typeof row.keyword !== 'string') return ''
  return row.keyword.trim().toLowerCase()
}

/**
 * Reduce GSC rows for the audit model: top 200 by impressions, plus up to 200
 * more striking-distance rows (deduped), max 300 total.
 * @param {Array<{ keyword: string, clicks?: number, impressions?: number, ctr?: number, position?: number }>} rows
 */
function trimGscAuditKeywords(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return []

  const topByImpressions = [...rows].sort(
    (a, b) => (b.impressions ?? 0) - (a.impressions ?? 0)
  )
  const top200 = topByImpressions.slice(0, 200)
  const seen = new Set()
  for (const r of top200) {
    const k = gscKeywordKey(r)
    if (k) seen.add(k)
  }

  const striking = rows.filter(
    (r) =>
      (r.position ?? 0) >= 4 &&
      (r.position ?? 0) <= 20 &&
      (r.impressions ?? 0) >= 50
  )
  striking.sort(
    (a, b) => (b.impressions ?? 0) - (a.impressions ?? 0)
  )

  const extra = []
  for (const r of striking) {
    if (extra.length >= 200) break
    const k = gscKeywordKey(r)
    if (!k || seen.has(k)) continue
    seen.add(k)
    extra.push(r)
  }

  return [...top200, ...extra].slice(0, 300)
}

/**
 * Monthly site audit for one brand. Never throws.
 * @param {string} brand
 */
export async function runAuditForBrand(brand) {
  const agent = agentNameFor(brand)
  const cfg = BRANDS[brand]
  const pillarNames = PILLARS[brand]
  const brandCtx = BRAND_CONTEXT[brand]

  try {
    if (!cfg || !pillarNames?.length || !brandCtx) {
      await base44.log(agent, brand, 'error', `Unknown brand or config: ${brand}`)
      return
    }

    await base44.log(agent, brand, 'info', `Starting monthly audit for ${brand}`)

    let pages = []
    try {
      pages = await crawlPagesFromSitemap(cfg.sitemap)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await base44.log(agent, brand, 'error', msg)
      return
    }

    await base44.log(agent, brand, 'info', `Crawled ${pages.length} pages`)

    let gsc = []
    let gscNote = null
    try {
      gsc = await getGSCAuditData(cfg.gscSite)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      gscNote = `GSC unavailable: ${msg}`
      await base44.log(agent, brand, 'error', `GSC: ${msg}`)
    }
    await base44.log(agent, brand, 'info', `Pulled ${gsc.length} keywords from GSC`)

    let ga4 = []
    let ga4Note = null
    try {
      ga4 = await getGA4Data(cfg.ga4PropertyId, { limit: 100 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ga4Note = `GA4 unavailable: ${msg}`
      await base44.log(agent, brand, 'error', `GA4: ${msg}`)
    }
    await base44.log(agent, brand, 'info', `Pulled top ${ga4.length} pages from GA4`)

    const gscForAudit = trimGscAuditKeywords(gsc)

    const report = await generateSiteAuditJson({
      brand,
      brandDescription: brandCtx.brandDescription,
      pillarNames,
      pages,
      gscKeywords: gscForAudit,
      ga4Pages: ga4,
      gscNote,
      ga4Note
    })

    if (!report) {
      await base44.log(
        agent,
        brand,
        'error',
        'Claude did not return a valid site audit JSON'
      )
      return
    }

    await base44.log(
      agent,
      brand,
      'info',
      `Audit complete: ${report.action_items.length} action items, ${report.content_gaps.length} content gaps, 12 posts planned`
    )

    await base44.archiveOldAudits(brand)

    const auditRow = await base44.createSiteAudit({
      brand,
      audit_date: auditDateIso(),
      summary: report.summary,
      pillar_map: JSON.stringify(report.pillar_map),
      content_gaps: JSON.stringify(report.content_gaps),
      action_items: JSON.stringify(report.action_items),
      status: 'active'
    })

    if (!auditRow) {
      await base44.log(agent, brand, 'error', 'createSiteAudit failed')
      return
    }

    for (const item of report.action_items) {
      if (!item || typeof item !== 'object') continue
      const urls = Array.isArray(item.affected_urls) ? item.affected_urls : []
      let recommendation =
        typeof item.recommendation === 'string' ? item.recommendation : ''
      if (item.estimated_benefit) {
        recommendation = recommendation
          ? `${recommendation} Expected benefit: ${item.estimated_benefit}`
          : String(item.estimated_benefit)
      }
      const created = await base44.createContentAction({
        brand,
        action_type: String(item.action_type ?? ''),
        affected_urls: urls,
        recommendation,
        reasoning: String(item.reasoning ?? ''),
        seo_impact: String(item.seo_impact ?? ''),
        status: 'pending'
      })
      if (!created) {
        await base44.log(
          agent,
          brand,
          'error',
          'createContentAction failed for one action item'
        )
      }
    }

    for (const plan of report.content_plan) {
      if (!plan || typeof plan !== 'object') continue
      const created = await base44.createPlannedPost({
        brand,
        title: String(plan.title ?? ''),
        keyword: String(plan.keyword ?? ''),
        type: String(plan.type ?? ''),
        pillar: String(plan.pillar ?? ''),
        reasoning: String(plan.reasoning ?? ''),
        estimated_impact: String(plan.estimated_impact ?? ''),
        priority: Number(plan.priority) || 0,
        status: 'planned'
      })
      if (!created) {
        await base44.log(
          agent,
          brand,
          'error',
          'createPlannedPost failed for one planned post'
        )
      }
    }

    await base44.log(
      agent,
      brand,
      'success',
      `Site audit saved to Base44 for ${brand}`
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await base44.log(agent, brand, 'error', msg)
  }
}
