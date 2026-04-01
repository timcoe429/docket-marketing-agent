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
