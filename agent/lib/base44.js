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
  meta_description,
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
      meta_description,
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
