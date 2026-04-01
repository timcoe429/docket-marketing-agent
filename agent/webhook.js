import 'dotenv/config'
import { execFile } from 'child_process'
import crypto from 'crypto'
import express from 'express'
import { promisify } from 'util'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')
const deployScript = join(repoRoot, 'deploy.sh')

const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT) || 3001
const secret = process.env.GITHUB_WEBHOOK_SECRET

const execFileAsync = promisify(execFile)

/**
 * @param {Buffer} rawBody
 * @param {string | undefined} signatureHeader
 * @param {string | undefined} webhookSecret
 */
function verifyGitHubSignature(rawBody, signatureHeader, webhookSecret) {
  if (!webhookSecret || typeof signatureHeader !== 'string') return false
  if (!signatureHeader.startsWith('sha256=')) return false
  const receivedHex = signatureHeader.slice('sha256='.length)
  const expectedHex = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex')
  try {
    const a = Buffer.from(receivedHex, 'hex')
    const b = Buffer.from(expectedHex, 'hex')
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

const app = express()

app.post(
  '/deploy',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!secret) {
      console.error('GITHUB_WEBHOOK_SECRET is not set')
      return res.status(503).json({ ok: false, error: 'Webhook not configured' })
    }

    const rawBody = req.body
    if (!Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ ok: false, error: 'Expected raw JSON body' })
    }

    const sig = req.get('X-Hub-Signature-256')
    if (!verifyGitHubSignature(rawBody, sig, secret)) {
      return res.status(401).json({ ok: false, error: 'Invalid signature' })
    }

    let payload
    try {
      payload = JSON.parse(rawBody.toString('utf8'))
    } catch {
      return res.status(400).json({ ok: false, error: 'Invalid JSON' })
    }

    if (payload.ref !== 'refs/heads/main') {
      return res.json({ ok: true, skipped: true })
    }

    try {
      await execFileAsync('bash', [deployScript], {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024
      })
      return res.json({ ok: true })
    } catch (err) {
      let message = err instanceof Error ? err.message : String(err)
      if (typeof err === 'object' && err !== null) {
        const stderr = 'stderr' in err ? String(err.stderr) : ''
        const stdout = 'stdout' in err ? String(err.stdout) : ''
        if (stderr.trim()) message = stderr.trim()
        else if (stdout.trim()) message = stdout.trim()
      }
      console.error('Deploy failed:', message)
      return res.status(500).json({ ok: false, error: message })
    }
  }
)

app.listen(WEBHOOK_PORT, () => {
  console.log(`Webhook listener on port ${WEBHOOK_PORT}`)
})
