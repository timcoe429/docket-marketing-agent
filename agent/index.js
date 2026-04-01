import 'dotenv/config'
import express from 'express'
import cron from 'node-cron'
import * as base44 from './lib/base44.js'
import {
  BRANDS as BRAND_CONFIG,
  publishToWordPress,
  runForBrand
} from './skills/content-pipeline.js'
import { runAuditForBrand } from './skills/site-audit.js'

const PORT = Number(process.env.PORT) || 3000
const BRANDS = Object.keys(BRAND_CONFIG)

let currentStatus = 'idle'
let lastRun = null
let pipelineLocked = false
let auditLocked = false

/** @type {Record<string, string>} */
const agentIdByBrand = {}

function agentRecordId(rec) {
  if (!rec || typeof rec !== 'object') return null
  return rec.id ?? rec._id ?? rec.entityId ?? null
}

function registerNameForBrand(brand) {
  return `content-agent-${brand.toLowerCase()}`
}

async function registerAgents() {
  const endpoint_url =
    process.env.AGENT_PUBLIC_URL || `http://localhost:${PORT}`

  for (const brand of BRANDS) {
    const rec = await base44.registerAgent({
      name: registerNameForBrand(brand),
      brand,
      status: 'idle',
      endpoint_url
    })
    const id = agentRecordId(rec)
    if (id) agentIdByBrand[brand] = id
  }
}

async function runPipeline() {
  if (pipelineLocked) {
    console.warn('runPipeline: already running, skip')
    return
  }
  pipelineLocked = true
  currentStatus = 'running'
  const started = new Date().toISOString()

  for (const brand of BRANDS) {
    const aid = agentIdByBrand[brand]
    if (aid) {
      await base44.updateAgent(aid, { status: 'running', last_run: started })
    }
  }

  try {
    await runForBrand('Docket')
    await runForBrand('ServiceCore')
    lastRun = new Date().toISOString()
    currentStatus = 'idle'
    for (const brand of BRANDS) {
      const aid = agentIdByBrand[brand]
      if (aid) {
        await base44.updateAgent(aid, { status: 'idle', last_run: lastRun })
      }
    }
  } catch (err) {
    console.error('runPipeline error:', err)
    currentStatus = 'error'
    lastRun = new Date().toISOString()
    for (const brand of BRANDS) {
      const aid = agentIdByBrand[brand]
      if (aid) {
        await base44.updateAgent(aid, { status: 'error', last_run: lastRun })
      }
    }
  } finally {
    pipelineLocked = false
  }
}

async function runAudit() {
  if (auditLocked) {
    console.warn('runAudit: already running, skip')
    return
  }
  auditLocked = true
  try {
    for (const brand of BRANDS) {
      await runAuditForBrand(brand)
    }
  } finally {
    auditLocked = false
  }
}

const app = express()
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() })
})

app.post('/run', (_req, res) => {
  void runPipeline()
  res.json({ ok: true, message: 'Pipeline started' })
})

app.post('/run/audit', (_req, res) => {
  void runAudit()
  res.json({ ok: true, message: 'Audit started' })
})

app.post('/run/publish', async (req, res) => {
  try {
    const { blogPostId, brand } = req.body ?? {}
    if (blogPostId == null || blogPostId === '') {
      return res.status(400).json({ ok: false, error: 'blogPostId required' })
    }
    if (!brand || !BRAND_CONFIG[brand]) {
      return res.status(400).json({ ok: false, error: 'Invalid brand' })
    }
    const result = await publishToWordPress(String(blogPostId), brand)
    if (!result.ok) {
      return res.status(502).json({
        ok: false,
        error: result.error || 'Publish failed'
      })
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('POST /run/publish:', err)
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
})

app.get('/status', (_req, res) => {
  res.json({ status: currentStatus, last_run: lastRun })
})

app.listen(PORT, async () => {
  console.log(`Agent listening on port ${PORT}`)
  await registerAgents()
})

cron.schedule(
  '0 8 * * 1',
  () => {
    void runPipeline()
  },
  { timezone: 'America/New_York' }
)

cron.schedule(
  '0 6 1 * *',
  () => {
    void runAudit()
  },
  { timezone: 'America/New_York' }
)
