# Current Plan

## Status: Phase 1 done (dashboard shell). Phase 2 — agent Express + Base44 integration (in progress / verify on droplet).

## Done
- [x] Supabase project (https://umvmnardjwaguswwzxad.supabase.co)
- [x] Schema — tables: `jobs`, `scan_results`, `seo_snapshots`, `content_topics`, `chat_messages`
- [x] Realtime on tables; RLS off
- [x] Repo scaffold: `/dashboard`, `/agent`
- [x] **Dashboard** — Next.js app with Supabase anon client (`lib/supabase.js`), main page with Docket-styled header, tabs (Security / SEO / Content / Chat), placeholder tab content, bottom Job Feed (last 20 `jobs`, Realtime INSERT/UPDATE), header connection indicator
- [x] **Agent (Phase 1, superseded)** — polling `jobs` in Supabase; replaced by Phase 2 below

## Phase 2 — Agent: Express + Base44 (complete when this runs without errors)
- [x] **Agent** — Express: `GET /health`, `POST /run` (non-blocking), `GET /status`; `node-cron` Monday 8:00 AM `America/New_York` → content pipeline for Docket then ServiceCore; startup `registerAgent` for both brands; `lib/base44.js` (axios, Agent / AgentLog / BlogPost entities); `lib/google.js` + `lib/claude.js`; `skills/content-pipeline.js` stub; `.env.example`; no Supabase in agent process (dashboard still uses Supabase)
- [ ] **Verify:** droplet or local — `npm start`, hit `/health` and `/status`, `POST /run` completes stub pipeline; Base44 shows Agent upserts and logs

## In Progress / Up Next
1. **Deploy dashboard** to Vercel (env: `NEXT_PUBLIC_SUPABASE_*`)
2. **Agent on droplet:** clone repo, `.env` (Anthropic, Google, Base44, `AGENT_PUBLIC_URL`, etc.), `pm2 start npm --name marketing-agent -- start`
3. **Content pipeline:** implement GSC + GA4 + Sheets + Claude + Docs + `createBlogPost` (stubs removed step by step)
4. **Other skills (order):** Security scan → GA4 → GSC → content — as needed for broader marketing agent

## Later
- Chat tab backed by `chat_messages` + Claude
- Security / SEO / Content tabs wired to their tables
- GA/GSC credentials and OAuth where required
