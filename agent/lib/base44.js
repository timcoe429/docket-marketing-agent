import axios from 'axios'

const BASE_URL =
  process.env.BASE44_API_BASE_URL || 'https://app.base44.com'

function getAppId() {
  return process.env.BASE44_APP_ID || '69c933514906e97b30004421'
}

function entityPath(entity) {
  return `/api/apps/${getAppId()}/entities/${entity}`
}

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
})

client.interceptors.request.use((config) => {
  const key = process.env.BASE44_API_KEY
  if (key) config.headers.api_key = key
  return config
})

function normalizeList(data) {
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.data)) return data.data
  if (data && Array.isArray(data.items)) return data.items
  if (data && Array.isArray(data.records)) return data.records
  if (data && Array.isArray(data.results)) return data.results
  return []
}

function recordId(row) {
  if (!row || typeof row !== 'object') return null
  return row.id ?? row._id ?? row.entityId ?? null
}

/**
 * Register or update an Agent (GET list → PUT by id or POST create).
 * @returns {Promise<object|null>} Agent record or null on failure
 */
export async function registerAgent({ name, brand, status, endpoint_url }) {
  try {
    const path = entityPath('Agent')
    const { data: raw } = await client.get(path)
    const list = normalizeList(raw)
    const existing = list.find(
      (a) => a && a.name === name && a.brand === brand
    )
    const body = { name, brand, status, endpoint_url }

    if (existing) {
      const id = recordId(existing)
      if (!id) {
        console.error('[base44] registerAgent: existing row has no id', existing)
        return null
      }
      const { data } = await client.put(`${path}/${id}`, body)
      return data ?? { ...existing, ...body, id }
    }

    const { data } = await client.post(path, body)
    return data ?? body
  } catch (err) {
    console.error(
      '[base44] registerAgent failed:',
      err.response?.data ?? err.message
    )
    return null
  }
}

export async function updateAgent(agentId, { status, last_run }) {
  try {
    const path = `${entityPath('Agent')}/${agentId}`
    const { data } = await client.put(path, { status, last_run })
    return data ?? { id: agentId, status, last_run }
  } catch (err) {
    console.error(
      '[base44] updateAgent failed:',
      err.response?.data ?? err.message
    )
    return null
  }
}

export async function log(agent_name, brand, level, message) {
  try {
    const path = entityPath('AgentLog')
    await client.post(path, { agent_name, brand, level, message })
  } catch (err) {
    console.error('[base44] log failed:', err.response?.data ?? err.message)
  }
}

export async function createBlogPost({
  title,
  brand,
  keyword,
  content,
  meta_title,
  meta_description,
  faq_schema,
  google_doc_url,
  status = 'draft'
}) {
  try {
    const path = entityPath('BlogPost')
    const body = {
      title,
      brand,
      keyword,
      content,
      meta_title,
      meta_description,
      faq_schema,
      status
    }
    if (google_doc_url != null) body.google_doc_url = google_doc_url
    const { data } = await client.post(path, body)
    return data ?? body
  } catch (err) {
    console.error(
      '[base44] createBlogPost failed:',
      err.response?.data ?? err.message
    )
    return null
  }
}

export async function getBlogPost(id) {
  try {
    const path = `${entityPath('BlogPost')}/${id}`
    const { data } = await client.get(path)
    return data ?? null
  } catch (err) {
    console.error(
      '[base44] getBlogPost failed:',
      err.response?.data ?? err.message
    )
    return null
  }
}

export async function updateBlogPost(id, fields) {
  try {
    const path = `${entityPath('BlogPost')}/${id}`
    const { data } = await client.put(path, fields)
    return data ?? { id, ...fields }
  } catch (err) {
    console.error(
      '[base44] updateBlogPost failed:',
      err.response?.data ?? err.message
    )
    return null
  }
}

export async function createSiteAudit({
  brand,
  audit_date,
  summary,
  pillar_map,
  content_gaps,
  action_items,
  status = 'active'
}) {
  try {
    const path = entityPath('SiteAudit')
    const body = {
      brand,
      audit_date,
      summary,
      pillar_map,
      content_gaps,
      action_items,
      status
    }
    const { data } = await client.post(path, body)
    return data ?? body
  } catch (err) {
    console.error(
      '[base44] createSiteAudit failed:',
      err.response?.data ?? err.message
    )
    return null
  }
}

export async function createContentAction({
  brand,
  action_type,
  affected_urls,
  recommendation,
  reasoning,
  seo_impact,
  status = 'pending'
}) {
  try {
    const path = entityPath('ContentAction')
    const urlsPayload = Array.isArray(affected_urls)
      ? JSON.stringify(affected_urls)
      : typeof affected_urls === 'string'
        ? affected_urls
        : JSON.stringify([])
    const body = {
      brand,
      action_type,
      affected_urls: urlsPayload,
      recommendation,
      reasoning,
      seo_impact,
      status
    }
    const { data } = await client.post(path, body)
    return data ?? body
  } catch (err) {
    console.error(
      '[base44] createContentAction failed:',
      err.response?.data ?? err.message
    )
    return null
  }
}

export async function createPlannedPost({
  brand,
  title,
  keyword,
  type,
  pillar,
  reasoning,
  estimated_impact,
  priority,
  status = 'planned'
}) {
  try {
    const path = entityPath('PlannedPost')
    const body = {
      brand,
      title,
      keyword,
      type,
      pillar,
      reasoning,
      estimated_impact,
      priority,
      status
    }
    const { data } = await client.post(path, body)
    return data ?? body
  } catch (err) {
    console.error(
      '[base44] createPlannedPost failed:',
      err.response?.data ?? err.message
    )
    return null
  }
}

/**
 * Highest-priority planned post for the brand (lower priority number = first).
 */
export async function getTopPlannedPost(brand) {
  try {
    const path = entityPath('PlannedPost')
    const { data: raw } = await client.get(path)
    const list = normalizeList(raw)
    const planned = list.filter(
      (row) =>
        row &&
        row.brand === brand &&
        String(row.status || '').toLowerCase() === 'planned'
    )
    planned.sort((a, b) => {
      const pa = Number(a.priority)
      const pb = Number(b.priority)
      const na = Number.isFinite(pa) ? pa : 9999
      const nb = Number.isFinite(pb) ? pb : 9999
      return na - nb
    })
    return planned[0] ?? null
  } catch (err) {
    console.error(
      '[base44] getTopPlannedPost failed:',
      err.response?.data ?? err.message
    )
    return null
  }
}

export async function updatePlannedPost(id, fields) {
  try {
    const path = `${entityPath('PlannedPost')}/${id}`
    const { data } = await client.put(path, fields)
    return data ?? { id, ...fields }
  } catch (err) {
    console.error(
      '[base44] updatePlannedPost failed:',
      err.response?.data ?? err.message
    )
    return null
  }
}

export async function createCROSnapshot(fields) {
  try {
    const path = entityPath('CROSnapshot')
    const { data } = await client.post(path, fields)
    return data ?? fields
  } catch (err) {
    console.error(
      '[base44] createCROSnapshot failed:',
      err.response?.data ?? err.message
    )
    return null
  }
}

export async function createCRORecommendation(fields) {
  try {
    const path = entityPath('CRORecommendation')
    const { data } = await client.post(path, fields)
    return data ?? fields
  } catch (err) {
    console.error(
      '[base44] createCRORecommendation failed:',
      err.response?.data ?? err.message
    )
    return null
  }
}

export async function archiveOldAudits(brand) {
  try {
    const path = entityPath('SiteAudit')
    const { data: raw } = await client.get(path)
    const list = normalizeList(raw)
    const active = list.filter(
      (row) =>
        row &&
        row.brand === brand &&
        String(row.status || '').toLowerCase() === 'active'
    )
    for (const row of active) {
      const id = recordId(row)
      if (!id) continue
      try {
        await client.put(`${path}/${id}`, { status: 'archived' })
      } catch (err) {
        console.error(
          '[base44] archiveOldAudits row failed:',
          err.response?.data ?? err.message
        )
      }
    }
  } catch (err) {
    console.error(
      '[base44] archiveOldAudits failed:',
      err.response?.data ?? err.message
    )
  }
}
