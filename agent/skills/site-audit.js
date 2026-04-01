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

    const report = await generateSiteAuditJson({
      brand,
      brandDescription: brandCtx.brandDescription,
      pillarNames,
      pages,
      gscKeywords: gsc,
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
      pillar_map: report.pillar_map,
      content_gaps: report.content_gaps,
      action_items: report.action_items,
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
