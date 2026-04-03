# Current Plan

## Status: Dashboard shell done. Agent Express + Base44 + **content pipeline (Phase 1)** implemented — verify end-to-end on droplet with real credentials.

## Done
- [x] Supabase project (https://umvmnardjwaguswwzxad.supabase.co)
- [x] Schema — tables: `jobs`, `scan_results`, `seo_snapshots`, `content_topics`, `chat_messages`
- [x] Realtime on tables; RLS off
- [x] Repo scaffold: `/dashboard`, `/agent`
- [x] **Dashboard** — Next.js app with Supabase anon client (`lib/supabase.js`), main page with Docket-styled header, tabs (Security / SEO / Content / Chat), placeholder tab content, bottom Job Feed (last 20 `jobs`, Realtime INSERT/UPDATE), header connection indicator
- [x] **Agent (historical)** — polling `jobs` in Supabase; replaced by Express agent below

## Phase 2 — Agent: Express + Base44 + content pipeline
- [x] **Agent** — Express: `GET /health`, `POST /run`, `POST /run/audit`, `POST /run/cro`, `POST /run/publish`, `GET /status`; `node-cron` Monday 8:00 AM `America/New_York` → content pipeline for Docket then ServiceCore; startup `registerAgent` for both brands; `lib/base44.js`; `lib/google.js` (GSC OAuth2 + GA4 service account); `lib/claude.js`; `skills/content-pipeline.js` (sitemap crawl, GSC/GA4, Claude → Base44 `BlogPost` `pending_review`, WordPress draft via `/run/publish`); `.env.example`; no Supabase in agent process (dashboard still uses Supabase)
- [ ] **Verify:** droplet or local — `npm start`, `/health`, `/status`, `POST /run` produces a `BlogPost` in Base44 and AgentLog steps; optional: `POST /run/publish` with `{ blogPostId, brand }` creates a **WordPress draft** and updates Base44 (`wp_draft_url`, status)

## Phase 2 — Content Intelligence
- [x] **Monthly site audit** — `skills/site-audit.js`: 1st of month 6:00 AM ET (`node-cron`) and `POST /run/audit`; full sitemap crawl (cap 200), full GSC keywords (positions 1–100), top 100 GA4 pages; Claude → Base44 **`SiteAudit`** (active), **`ContentAction`** rows per action item, **`PlannedPost`** rows (12, `planned`). Prior active audits archived. Failures logged to AgentLog; agent does not crash on audit errors; GSC/GA4 failures continue with empty data + summary note.
- [x] **Weekly writer** — `POST /run` / Monday cron: pulls highest-priority **`PlannedPost`** (`status=planned`, sort `priority` ascending); sets `writing` → generates post for fixed title/keyword/pillar → `createBlogPost` → `written`. If no planned post, falls back to autonomous topic selection (striking-distance keywords) with an AgentLog info line.
- Base44 is the surface for site structure, content plan, action items, and the post queue (alongside existing `BlogPost` workflow).

## CRO agent (Docket)
- [x] **CRO agent** — `skills/cro-agent.js`: bi-weekly Mondays 9:00 AM ET when day-of-month is 1–7 or 15–21 (`node-cron`) and `POST /run/cro`. Pulls GA4 **`generate_lead`** event counts (via `eventCount` + `eventName` filter) and **sessions** per money page and device (mobile/desktop/tablet) for the last 14 days vs the prior 14 days (anchor: yesterday ET). **Puppeteer-core** screenshots (mobile 390×844, desktop 1440×900) to `/tmp/cro-screenshots/`, then **Claude** (`claude-sonnet-4-6`, web search tool) with metrics + images → one test idea per page. Saves **`CROSnapshot`** per page and **one** **`CRORecommendation`** (highest priority) to Base44; AgentLog milestones; failures do not crash the Express process; temp screenshots always cleaned up.

## In Progress / Up Next
1. **Deploy dashboard** to Vercel (env: `NEXT_PUBLIC_SUPABASE_*`)
2. **Agent on droplet:** clone repo, `.env` (Anthropic, Google OAuth + service account path, Base44, WP app passwords, `AGENT_PUBLIC_URL`, etc.), `pm2 start npm --name marketing-agent -- start`
3. **Other skills (order):** Security scan → broader SEO automation — as needed

## Later
- Chat tab backed by `chat_messages` + Claude
- Security / SEO / Content tabs wired to their tables
