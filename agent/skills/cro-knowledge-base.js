import fs from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import * as base44 from '../lib/base44.js'
import { generateCROKnowledgeBaseJson } from '../lib/claude.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CRO_KNOWLEDGE_DIR = join(__dirname, '..', 'data')
const CRO_KNOWLEDGE_FILE = join(CRO_KNOWLEDGE_DIR, 'cro-knowledge-base.json')

const AGENT_NAME = 'cro-knowledge-base'

function todayEtYmd() {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/New_York'
  })
}

/**
 * Monthly (or manual) SaaS CRO knowledge refresh → local JSON file + Base44 metadata.
 * Never throws.
 * @param {string} brand
 */
export async function updateCROKnowledgeBase(brand) {
  try {
    await base44.log(
      AGENT_NAME,
      brand,
      'info',
      'Starting CRO knowledge base research'
    )

    const parsed = await generateCROKnowledgeBaseJson()
    if (!parsed) {
      await base44.log(
        AGENT_NAME,
        brand,
        'error',
        'CRO knowledge base: Claude returned no valid JSON'
      )
      return
    }

    fs.mkdirSync(CRO_KNOWLEDGE_DIR, { recursive: true })
    fs.writeFileSync(CRO_KNOWLEDGE_FILE, JSON.stringify(parsed, null, 2), 'utf8')

    const last_updated = todayEtYmd()
    const nSources = Array.isArray(parsed.sources_searched)
      ? parsed.sources_searched.length
      : 0
    const summary = `SaaS CRO benchmarks and patterns (${parsed.last_researched || last_updated}); ${nSources} source topics.`

    const row = await base44.upsertCROKnowledgeBase({
      brand,
      last_updated,
      summary
    })

    if (!row) {
      await base44.log(
        AGENT_NAME,
        brand,
        'error',
        'CRO knowledge base: upsertCROKnowledgeBase failed'
      )
      return
    }

    await base44.log(
      AGENT_NAME,
      brand,
      'success',
      `CRO knowledge base updated for ${brand}`
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await base44.log(AGENT_NAME, brand, 'error', msg)
  }
}
