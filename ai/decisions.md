# Decisions

## Single repo, two folders
One GitHub repo with `/dashboard` and `/agent` subfolders. Simpler to manage than two repos.

## Dashboard before agent (historical)
The dashboard was built first as the visibility surface for jobs; the agent skeleton now exists in parallel.

## RLS disabled on Supabase
Private internal tool. RLS adds complexity with no benefit here.

## DigitalOcean droplet for agent
Needs persistent polling/cron and SSH access. Vercel serverless does not replace that.

## Base44 is dashboard / control plane for the content agent
The droplet agent reports status, logs, and blog drafts to **Base44** via REST (`Agent`, `AgentLog`, `BlogPost` entities). The agent exposes a small **Express** API (`/health`, `/run`, `/status`) for triggers and health checks. The Next.js **dashboard** remains the Supabase-backed UI for jobs and is separate from Base44.

## Skills build order
Security scan first (no OAuth complexity), then GA4 (service account, simpler), then GSC (OAuth2 is the hard part), then content pipeline.

## Jobs: column name `type`
The `jobs` table uses **`type`** for job kind (e.g. skill routing). The dashboard Job Feed and agent logs use this column — not `job_type`.

## Docket brand on dashboard
Light theme only (no dark mode toggle). Colors and Lato per brand guidelines; documented in `ai/context.md`.

## Skill / SSH placeholders
`agent/skills/content-pipeline.js` is a **non-empty stub** (logs + TODO phases) and may evolve into the full pipeline. Other skill files under `agent/skills/` and `agent/lib/ssh.js`, when added, remain placeholders until those skills are implemented — do not remove them arbitrarily.
