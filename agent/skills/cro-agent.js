import fs from 'fs'
import path from 'path'
import puppeteer from 'puppeteer-core'
import * as base44 from '../lib/base44.js'
import { analyzeCROPageJson } from '../lib/claude.js'
import {
  getCROMoneyPageMetrics,
  normalizeGa4PagePath
} from '../lib/google.js'
import { BRANDS } from './content-pipeline.js'

const AGENT_NAME = 'cro-agent'
const BRAND = 'Docket'

const BASE_URL = 'https://www.yourdocket.com'

export const DOCKET_MONEY_PAGES = [
  { path: '/dumpster-rental-software/', name: 'Dumpster Rental Software' },
  { path: '/dumpster-rental-software-ppc/', name: 'Dumpster Rental Software PPC' },
  { path: '/schedule-a-demo/', name: 'Schedule a Demo' },
  { path: '/commercial-residential-waste/', name: 'Commercial Residential Waste' },
  { path: '/commercial-residential-ppc/', name: 'Commercial Residential PPC' },
  { path: '/junk-removal-software/', name: 'Junk Removal Software' },
  { path: '/ironroute-ai/', name: 'IronRoute AI' }
]

const SCREENSHOT_DIR = '/tmp/cro-screenshots'
const CHROMIUM_PATH = '/usr/bin/chromium-browser'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const DEVICES = ['mobile', 'desktop', 'tablet']

function pathToSlug(pagePath) {
  const s = pagePath.replace(/^\/|\/$/g, '').replace(/\//g, '-')
  return s || 'home'
}

function todayEtYmd() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/New_York'
  })
}

function ratePct(conversions, sessions) {
  if (!sessions || sessions <= 0) return 0
  return Math.round((conversions / sessions) * 10000) / 100
}

/**
 * change_pct = ((current - previous) / previous) * 100 for rates; null if previous_rate is 0.
 */
function changePctRates(currentRate, previousRate) {
  if (previousRate === 0) return null
  return Math.round(((currentRate - previousRate) / previousRate) * 1000) / 10
}

function lookupMaps(maps, pagePath, device) {
  const key = `${normalizeGa4PagePath(pagePath)}|${device.toLowerCase()}`
  return maps.get(key) ?? 0
}

/**
 * @param {string} pagePath
 * @param {string} pageName
 * @param {{
 *   sessionsCurrent: Map<string, number>,
 *   sessionsPrevious: Map<string, number>,
 *   leadsCurrent: Map<string, number>,
 *   leadsPrevious: Map<string, number>
 * }} maps
 */
function buildDeviceBreakdown(pagePath, pageName, maps) {
  const byDevice = {}
  const claudeRows = []

  for (const device of DEVICES) {
    const current_sessions = lookupMaps(maps.sessionsCurrent, pagePath, device)
    const previous_sessions = lookupMaps(maps.sessionsPrevious, pagePath, device)
    const current_conversions = lookupMaps(maps.leadsCurrent, pagePath, device)
    const previous_conversions = lookupMaps(maps.leadsPrevious, pagePath, device)
    const current_rate = ratePct(current_conversions, current_sessions)
    const previous_rate = ratePct(previous_conversions, previous_sessions)
    const change_pct = changePctRates(current_rate, previous_rate)

    byDevice[device] = {
      current_sessions,
      previous_sessions,
      current_conversions,
      previous_conversions,
      current_rate,
      previous_rate,
      change_pct
    }

    claudeRows.push({
      page: pagePath,
      name: pageName,
      device,
      current_sessions,
      current_conversions,
      current_rate,
      previous_sessions,
      previous_conversions,
      previous_rate,
      change_pct
    })
  }

  return { byDevice, claudeRows }
}

function priorityScore(p) {
  const x = String(p || '').toLowerCase()
  if (x === 'high') return 3
  if (x === 'medium') return 2
  if (x === 'low') return 1
  return 0
}

function tieMetricFromFocus(deviceFocus, byDevice) {
  const f = String(deviceFocus || '').toLowerCase()
  const abs = (row) =>
    row && row.change_pct != null ? Math.abs(row.change_pct) : 0
  if (f === 'both') {
    return Math.max(
      abs(byDevice.mobile),
      abs(byDevice.desktop),
      abs(byDevice.tablet)
    )
  }
  if (byDevice[f]) return abs(byDevice[f])
  return Math.max(
    abs(byDevice.mobile),
    abs(byDevice.desktop),
    abs(byDevice.tablet)
  )
}

function cleanupScreenshotDir() {
  try {
    fs.rmSync(SCREENSHOT_DIR, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

/**
 * Never throws to the Express process.
 */
export async function runCROAgent() {
  const propertyId = BRANDS[BRAND]?.ga4PropertyId
  const pagePaths = DOCKET_MONEY_PAGES.map((p) => p.path)

  try {
    await base44.log(
      AGENT_NAME,
      BRAND,
      'info',
      'Starting CRO agent for Docket'
    )

    let maps = {
      sessionsCurrent: new Map(),
      sessionsPrevious: new Map(),
      leadsCurrent: new Map(),
      leadsPrevious: new Map()
    }
    let ga4Failed = false

    try {
      if (!propertyId) {
        throw new Error('Docket ga4PropertyId missing in BRANDS config')
      }
      const raw = await getCROMoneyPageMetrics(propertyId, pagePaths)
      maps = {
        sessionsCurrent: raw.sessionsCurrent,
        sessionsPrevious: raw.sessionsPrevious,
        leadsCurrent: raw.leadsCurrent,
        leadsPrevious: raw.leadsPrevious
      }
    } catch (err) {
      ga4Failed = true
      const msg = err instanceof Error ? err.message : String(err)
      await base44.log(AGENT_NAME, BRAND, 'error', msg)
    }

    const nPagesData = ga4Failed ? 0 : DOCKET_MONEY_PAGES.length
    await base44.log(
      AGENT_NAME,
      BRAND,
      'info',
      `Pulled conversion data for ${nPagesData} pages`
    )

    try {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
    } catch {
      /* ignore EEXIST */
    }

    const screenshotPaths = new Map()
    let browser
    try {
      browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ],
        headless: true
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await base44.log(
        AGENT_NAME,
        BRAND,
        'error',
        `Puppeteer launch failed: ${msg}`
      )
    }

    if (browser) {
      try {
        for (const { path: pagePath } of DOCKET_MONEY_PAGES) {
          const slug = pathToSlug(pagePath)
          const url = `${BASE_URL.replace(/\/$/, '')}${pagePath.startsWith('/') ? pagePath : `/${pagePath}`}`
          const mobileFile = path.join(SCREENSHOT_DIR, `${slug}-mobile.png`)
          const desktopFile = path.join(SCREENSHOT_DIR, `${slug}-desktop.png`)
          const entry = { mobile: null, desktop: null }

          const page = await browser.newPage()
          try {
            await page.setViewport({
              width: 390,
              height: 844,
              deviceScaleFactor: 2
            })
            await page.setUserAgent(MOBILE_UA)
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
            await page.screenshot({ path: mobileFile, type: 'png' })
            entry.mobile = mobileFile
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            await base44.log(
              AGENT_NAME,
              BRAND,
              'error',
              `Screenshot mobile ${pagePath}: ${msg}`
            )
          }

          try {
            await page.setViewport({
              width: 1440,
              height: 900,
              deviceScaleFactor: 1
            })
            await page.setUserAgent(
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            )
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
            await page.screenshot({ path: desktopFile, type: 'png' })
            entry.desktop = desktopFile
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            await base44.log(
              AGENT_NAME,
              BRAND,
              'error',
              `Screenshot desktop ${pagePath}: ${msg}`
            )
          }

          await page.close().catch(() => {})
          screenshotPaths.set(pagePath, entry)
        }
      } finally {
        await browser.close().catch(() => {})
      }
    }

    let capturedPages = 0
    for (const { path: pagePath } of DOCKET_MONEY_PAGES) {
      const e = screenshotPaths.get(pagePath)
      if (e && (e.mobile || e.desktop)) capturedPages++
    }
    await base44.log(
      AGENT_NAME,
      BRAND,
      'info',
      `Screenshots captured for ${capturedPages} pages`
    )

    let knowledgeBaseContext = 'No knowledge base on file.'
    try {
      const kb = await base44.getCROKnowledgeBase(BRAND)
      if (kb?.content) knowledgeBaseContext = String(kb.content)
    } catch {
      /* keep default */
    }

    let activeTestsContext = 'No active tests.'
    try {
      const tests = (await base44.getTestingRecommendations(BRAND)) ?? []
      activeTestsContext = tests.length
        ? JSON.stringify(tests, null, 2)
        : 'No active tests.'
    } catch {
      /* keep default */
    }

    const recommendations = []
    const dateStr = todayEtYmd()

    for (const { path: pagePath, name: pageName } of DOCKET_MONEY_PAGES) {
      const { byDevice, claudeRows } = buildDeviceBreakdown(
        pagePath,
        pageName,
        maps
      )

      let mobileBase64 = null
      let desktopBase64 = null
      const shots = screenshotPaths.get(pagePath)
      try {
        if (shots?.mobile && fs.existsSync(shots.mobile)) {
          mobileBase64 = fs.readFileSync(shots.mobile).toString('base64')
        }
        if (shots?.desktop && fs.existsSync(shots.desktop)) {
          desktopBase64 = fs.readFileSync(shots.desktop).toString('base64')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await base44.log(
          AGENT_NAME,
          BRAND,
          'error',
          `Read screenshot ${pagePath}: ${msg}`
        )
      }

      const claudeResult = await analyzeCROPageJson({
        pagePath,
        pageName,
        metricsJson: claudeRows,
        mobileBase64,
        desktopBase64,
        knowledgeBaseContext,
        activeTestsContext
      })

      if (claudeResult) {
        recommendations.push({
          ...claudeResult,
          page_path: pagePath,
          page_name: pageName,
          byDevice,
          tieMetric: tieMetricFromFocus(claudeResult.device_focus, byDevice)
        })
      }

      const snap = await base44.createCROSnapshot({
        brand: BRAND,
        page_path: pagePath,
        page_name: pageName,
        snapshot_date: dateStr,
        mobile_sessions: byDevice.mobile.current_sessions,
        mobile_conversions: byDevice.mobile.current_conversions,
        mobile_rate: byDevice.mobile.current_rate,
        mobile_change_pct: byDevice.mobile.change_pct,
        desktop_sessions: byDevice.desktop.current_sessions,
        desktop_conversions: byDevice.desktop.current_conversions,
        desktop_rate: byDevice.desktop.current_rate,
        desktop_change_pct: byDevice.desktop.change_pct,
        tablet_sessions: byDevice.tablet.current_sessions,
        tablet_conversions: byDevice.tablet.current_conversions,
        tablet_rate: byDevice.tablet.current_rate,
        tablet_change_pct: byDevice.tablet.change_pct
      })

      if (!snap) {
        await base44.log(
          AGENT_NAME,
          BRAND,
          'error',
          `createCROSnapshot failed for ${pagePath}`
        )
      }
    }

    await base44.log(AGENT_NAME, BRAND, 'info', 'CRO analysis complete')

    recommendations.sort((a, b) => {
      const pd = priorityScore(b.priority) - priorityScore(a.priority)
      if (pd !== 0) return pd
      const td = (b.tieMetric ?? 0) - (a.tieMetric ?? 0)
      if (td !== 0) return td
      return 0
    })

    const top = recommendations[0]
    if (top) {
      const rec = await base44.createCRORecommendation({
        brand: BRAND,
        page_path: top.page_path,
        page_name: top.page_name,
        observation: top.observation,
        benchmark_comparison: top.benchmark_comparison,
        benchmark_gap: top.benchmark_gap,
        hypothesis: top.hypothesis,
        what_to_test: top.what_to_test,
        device_focus: top.device_focus,
        priority: top.priority,
        reasoning: top.reasoning,
        status: 'pending',
        created_at: dateStr
      })
      if (!rec) {
        await base44.log(
          AGENT_NAME,
          BRAND,
          'error',
          'createCRORecommendation failed'
        )
      }
    }

    await base44.log(
      AGENT_NAME,
      BRAND,
      'success',
      'CRO snapshots and recommendation saved to Base44'
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await base44.log(AGENT_NAME, BRAND, 'error', msg)
  } finally {
    cleanupScreenshotDir()
  }
}
