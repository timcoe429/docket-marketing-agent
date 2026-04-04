import { BetaAnalyticsDataClient } from '@google-analytics/data'
import { google } from 'googleapis'

export const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob'
)

if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  })
}

function gscDateRange() {
  const end = new Date()
  end.setUTCDate(end.getUTCDate() - 3)
  const endDate = end.toISOString().slice(0, 10)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 89)
  const startDate = start.toISOString().slice(0, 10)
  return { startDate, endDate }
}

/**
 * Search Console queries for the last ~90 days ending 3 days ago (GSC lag).
 * Returns striking-distance rows only: position 4–20, impressions >= 50.
 * @param {string} siteUrl — property URL as in GSC (e.g. https://www.example.com/)
 * @returns {Promise<Array<{ keyword: string, clicks: number, impressions: number, ctr: number, position: number }>>}
 */
export async function getGSCData(siteUrl) {
  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('GSC: GOOGLE_REFRESH_TOKEN is not set')
  }

  const searchconsole = google.searchconsole({ version: 'v1', auth: oauth2Client })
  const { startDate, endDate } = gscDateRange()

  const res = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ['query'],
      rowLimit: 500
    }
  })

  const rows = res.data.rows ?? []
  const mapped = rows.map((row) => ({
    keyword: row.keys?.[0] ?? '',
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0
  }))

  return mapped.filter(
    (r) =>
      r.position >= 4 &&
      r.position <= 20 &&
      r.impressions >= 50 &&
      r.keyword.length > 0
  )
}

/**
 * Full GSC query export for site audits: positions 1–100 (no striking-distance filter).
 * @param {string} siteUrl
 * @returns {Promise<Array<{ keyword: string, clicks: number, impressions: number, ctr: number, position: number }>>}
 */
export async function getGSCAuditData(siteUrl) {
  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('GSC: GOOGLE_REFRESH_TOKEN is not set')
  }

  const searchconsole = google.searchconsole({ version: 'v1', auth: oauth2Client })
  const { startDate, endDate } = gscDateRange()

  const res = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ['query'],
      rowLimit: 25000
    }
  })

  const rows = res.data.rows ?? []
  const mapped = rows.map((row) => ({
    keyword: row.keys?.[0] ?? '',
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0
  }))

  return mapped.filter(
    (r) =>
      r.keyword.length > 0 &&
      r.position >= 1 &&
      r.position <= 100
  )
}

function ga4DateRange() {
  const end = new Date()
  end.setUTCDate(end.getUTCDate() - 3)
  const endDate = end.toISOString().slice(0, 10)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 89)
  const startDate = start.toISOString().slice(0, 10)
  return { startDate, endDate }
}

let _ga4Client = null
function getGA4Client() {
  const path = process.env.GOOGLE_SERVICE_ACCOUNT_PATH
  if (!path) {
    throw new Error('GA4: GOOGLE_SERVICE_ACCOUNT_PATH is not set')
  }
  if (!_ga4Client) {
    _ga4Client = new BetaAnalyticsDataClient({ keyFilename: path })
  }
  return _ga4Client
}

/**
 * Top pages by sessions (last ~90 days, end date 3 days ago).
 * @param {string} propertyId — numeric GA4 property id
 * @returns {Promise<Array<{ page: string, sessions: number, users: number, conversions: number }>>}
 */
async function runGa4Report(
  client,
  propertyId,
  startDate,
  endDate,
  metrics,
  limit = 50
) {
  return client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'pagePath' }],
    metrics,
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit
  })
}

function mapGa4Rows(response, conversionsIndex) {
  const out = []
  for (const row of response.rows ?? []) {
    const page = row.dimensionValues?.[0]?.value ?? ''
    const sessions = Number(row.metricValues?.[0]?.value ?? 0)
    const users = Number(row.metricValues?.[1]?.value ?? 0)
    const conversions =
      conversionsIndex >= 0
        ? Number(row.metricValues?.[conversionsIndex]?.value ?? 0)
        : 0
    out.push({ page, sessions, users, conversions })
  }
  return out
}

/**
 * @param {string} propertyId
 * @param {{ limit?: number }} [options] — default limit 50; use 100 for monthly audit
 */
export async function getGA4Data(propertyId, options = {}) {
  const limit = Number(options.limit) > 0 ? Number(options.limit) : 50
  const client = getGA4Client()
  const { startDate, endDate } = ga4DateRange()

  const fullMetrics = [
    { name: 'sessions' },
    { name: 'activeUsers' },
    { name: 'conversions' }
  ]

  try {
    const [response] = await runGa4Report(
      client,
      propertyId,
      startDate,
      endDate,
      fullMetrics,
      limit
    )
    return mapGa4Rows(response, 2)
  } catch (err1) {
    try {
      const [response] = await runGa4Report(
        client,
        propertyId,
        startDate,
        endDate,
        [{ name: 'sessions' }, { name: 'activeUsers' }],
        limit
      )
      return mapGa4Rows(response, -1)
    } catch (err2) {
      throw err2
    }
  }
}

const CRO_TZ = 'America/New_York'
const GA4_LEAD_EVENT = 'generate_lead'

/**
 * Normalize GA4 / config paths for matching (lowercase, leading slash, no trailing slash except root).
 * @param {string} path
 */
export function normalizeGa4PagePath(path) {
  let p = String(path || '').trim().toLowerCase()
  if (!p.startsWith('/')) p = `/${p}`
  p = p.replace(/\/+$/, '')
  return p || '/'
}

function addDaysYmd(ymd, deltaDays) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + deltaDays)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/**
 * Calendar yesterday in America/New_York (YYYY-MM-DD). CRO reports use this as the end date
 * for the "current" 14-day window (unlike ga4DateRange() which uses a T-3 lag for long pulls).
 */
export function getCROReportEndDateEt() {
  const todayEt = new Date().toLocaleDateString('en-CA', {
    timeZone: CRO_TZ
  })
  return addDaysYmd(todayEt, -1)
}

/**
 * Inclusive 14-day current window ending at `endYmd`, and the prior 14-day window.
 * @param {string} endYmd
 * @returns {{ currentStart: string, currentEnd: string, previousStart: string, previousEnd: string }}
 */
export function getCROFourteenDayRanges(endYmd) {
  const currentEnd = endYmd
  const currentStart = addDaysYmd(currentEnd, -13)
  const previousEnd = addDaysYmd(currentStart, -1)
  const previousStart = addDaysYmd(previousEnd, -13)
  return { currentStart, currentEnd, previousStart, previousEnd }
}

function expandPathVariantsForFilter(paths) {
  const set = new Set()
  for (const p of paths) {
    const n = normalizeGa4PagePath(p)
    set.add(n)
    set.add(`${n}/`)
  }
  return [...set]
}

function pagePathDimensionFilter(paths) {
  const values = expandPathVariantsForFilter(paths)
  return {
    filter: {
      fieldName: 'pagePath',
      inListFilter: {
        caseSensitive: false,
        values
      }
    }
  }
}

const generateLeadEventFilter = {
  filter: {
    fieldName: 'eventName',
    stringFilter: {
      matchType: 'EXACT',
      value: GA4_LEAD_EVENT
    }
  }
}

/** @returns {Map<string, number>} key `${normalizePath}|${device}` -> metric value (e.g. activeUsers for CRO) */
function mapPathDeviceMetrics(response) {
  const m = new Map()
  for (const row of response.rows ?? []) {
    const page = row.dimensionValues?.[0]?.value ?? ''
    const device = String(row.dimensionValues?.[1]?.value ?? '').toLowerCase()
    const val = Number(row.metricValues?.[0]?.value ?? 0)
    const key = `${normalizeGa4PagePath(page)}|${device}`
    m.set(key, (m.get(key) ?? 0) + val)
  }
  return m
}

/** @returns {Map<string, number>} */
function mapPathDeviceLeads(response) {
  const m = new Map()
  for (const row of response.rows ?? []) {
    const page = row.dimensionValues?.[0]?.value ?? ''
    const device = String(row.dimensionValues?.[1]?.value ?? '').toLowerCase()
    const eventName = String(row.dimensionValues?.[2]?.value ?? '').toLowerCase()
    if (eventName && eventName !== GA4_LEAD_EVENT) continue
    const val = Number(row.metricValues?.[0]?.value ?? 0)
    const key = `${normalizeGa4PagePath(page)}|${device}`
    m.set(key, (m.get(key) ?? 0) + val)
  }
  return m
}

async function runCroActiveUsersWindow(
  client,
  propertyId,
  startDate,
  endDate,
  pathFilter
) {
  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'pagePath' }, { name: 'deviceCategory' }],
    metrics: [{ name: 'activeUsers' }],
    dimensionFilter: pathFilter,
    limit: 10000
  })
  return mapPathDeviceMetrics(response)
}

async function runCroLeadsWindow(client, propertyId, startDate, endDate, pathFilter) {
  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate }],
    dimensions: [
      { name: 'pagePath' },
      { name: 'deviceCategory' },
      { name: 'eventName' }
    ],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      andGroup: {
        expressions: [pathFilter, generateLeadEventFilter]
      }
    },
    limit: 10000
  })
  return mapPathDeviceLeads(response)
}

/**
 * Active users and generate_lead event counts per pagePath + device for two 14-day windows.
 * Rates use conversions / activeUsers to align with typical Looker Studio explorations.
 * @param {string} propertyId
 * @param {string[]} pagePaths — money page paths from config
 * @returns {Promise<{
 *   ranges: { currentStart: string, currentEnd: string, previousStart: string, previousEnd: string },
 *   activeUsersCurrent: Map<string, number>,
 *   activeUsersPrevious: Map<string, number>,
 *   leadsCurrent: Map<string, number>,
 *   leadsPrevious: Map<string, number>
 * }>}
 */
export async function getCROMoneyPageMetrics(propertyId, pagePaths) {
  const client = getGA4Client()
  const endYmd = getCROReportEndDateEt()
  const ranges = getCROFourteenDayRanges(endYmd)
  const pathFilter = pagePathDimensionFilter(pagePaths)

  const [
    activeUsersCurrent,
    activeUsersPrevious,
    leadsCurrent,
    leadsPrevious
  ] = await Promise.all([
    runCroActiveUsersWindow(
      client,
      propertyId,
      ranges.currentStart,
      ranges.currentEnd,
      pathFilter
    ),
    runCroActiveUsersWindow(
      client,
      propertyId,
      ranges.previousStart,
      ranges.previousEnd,
      pathFilter
    ),
    runCroLeadsWindow(
      client,
      propertyId,
      ranges.currentStart,
      ranges.currentEnd,
      pathFilter
    ),
    runCroLeadsWindow(
      client,
      propertyId,
      ranges.previousStart,
      ranges.previousEnd,
      pathFilter
    )
  ])

  return {
    ranges,
    activeUsersCurrent,
    activeUsersPrevious,
    leadsCurrent,
    leadsPrevious
  }
}
