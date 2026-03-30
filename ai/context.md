# Project Context

## What This Is
A custom AI agent system for Docket and ServiceCore marketing operations. An agent runs on a DigitalOcean droplet (PM2), performs automated tasks (security scans, SEO pulls, content generation), writes results to Supabase, and a Next.js dashboard (Vercel) monitors jobs in realtime with a shell for Security, SEO, Content, and Chat.

## Tech Stack
- **Agent:** Node.js (ES modules), PM2 on DigitalOcean droplet; `@supabase/supabase-js`, `@anthropic-ai/sdk`, `dotenv`, `node-cron`, `node-ssh`
- **Database:** Supabase (Postgres + Realtime) — https://umvmnardjwaguswwzxad.supabase.co
- **Dashboard:** Next.js (App Router), Tailwind v4, TypeScript/JS mix; `@supabase/supabase-js`; deployed to Vercel
- **AI:** Anthropic API (`claude-sonnet-4-6`) — used from agent (`lib/claude.js`) and optionally future server routes
- **Image gen:** Gemini Imagen (imagen-4.0-generate-001) — planned for content pipeline
- **SSH:** node-ssh (installed on agent; `lib/ssh.js` placeholder until security skill)

## Repo layout (implemented)
- **`/dashboard`** — Marketing Agent UI: `app/page.tsx` (client shell), `app/components/` (`JobFeed`, tab placeholders, `ChatPanel`), `lib/supabase.js` (browser client, **anon key only**)
- **`/agent`** — `index.js` polls `jobs` every 30s; `lib/supabase.js` (service key), `lib/claude.js` (`ask()`); `skills/*.js` and `lib/ssh.js` are **empty placeholders** until skills are built

## Environment variables
| Where | Vars |
|-------|------|
| Dashboard (`.env.local`) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Agent (`.env`, gitignored) | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY` |

Never expose `SUPABASE_SERVICE_KEY` or service role to the browser.

## Data: `jobs` table (dashboard + agent)
- Job kind is stored in column **`type`** (not `job_type`).
- Agent selects `pending` jobs, sets `running` / `started_at`, then `done` or `error` with `result` / `error` and `completed_at` (stub handler until skills exist).

## Dashboard UX (Docket brand)
- **Font:** Lato (400/700/900) via `next/font/google` in `app/layout.tsx`; default sans in `app/globals.css`
- **Palette (reference):** primary blue `#185FB0`, primary green `#7EB10F`, text `#181e2b`, muted `#7a8494`, page bg `#f5f7fa`, borders `#dce8f7`, white panels
- **Chrome:** 5px top gradient (blue → green), header realtime status (`realtime:header` on `jobs`), four tabs, main card with soft blue shadow, bottom **Job Feed** (`realtime:job-feed`, last 20 rows, INSERT/UPDATE)
- **Job feed:** Status badges: pending=yellow, running=blue, done=green, error=red; timestamps America/New_York.

## Three Skills (not implemented yet)
1. **Security Scan** — SSH into WPMU DEV hosts, WP Defender, `scan_results` (read-only on prod)
2. **SEO Intelligence** — GA4 + GSC → `seo_snapshots`
3. **Content Pipeline** — topics → approval → WP **drafts only**

## Hard Rules
- Never publish WordPress posts — always status: `draft`
- Never fix/quarantine/delete anything on production during security scans (read-only)
- `service_role` / `SUPABASE_SERVICE_KEY` = server/agent only, never browser
- Credentials in env files — never hardcoded
- Always timezone: `America/New_York` in node-cron (when cron is used)
- GSC requires OAuth2 — service accounts do NOT work

## Repo Structure
One repo, two folders: `/dashboard` (Vercel) and `/agent` (DigitalOcean droplet).
