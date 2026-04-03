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
The droplet agent reports status, logs, and blog drafts to **Base44** via REST (`Agent`, `AgentLog`, `BlogPost`, `SiteAudit`, `ContentAction`, `PlannedPost`, `CROSnapshot`, `CRORecommendation` entities). **Base44 is the single source of truth** for generated draft content and the monthly content plan / action queue (no Google Sheets/Drive/Docs in this flow). The agent exposes **Express** APIs: `GET /health`, `POST /run` (weekly content pipeline), `POST /run/audit` (fire-and-forget monthly audit for all brands), `POST /run/cro` (fire-and-forget CRO agent for Docket), `POST /run/publish` (body: `{ blogPostId, brand }` — pushes a **WordPress draft** after approval or manual trigger), `GET /status`. The Next.js **dashboard** remains the Supabase-backed UI for jobs and is separate from Base44.

## Content intelligence: audit vs weekly writer
The **monthly audit** (1st of month, 6:00 AM `America/New_York`, or manual `POST /run/audit`) produces a new **`SiteAudit`**, many **`ContentAction`** records, and exactly **12** **`PlannedPost`** rows per brand (`status=planned`, `priority` lower = higher priority). The **weekly writer** no longer picks its own topic when a planned post exists: it consumes the top **`PlannedPost`**, then marks it **`written`** after a **`BlogPost`** is created. If no planned posts exist yet, it **falls back** to autonomous topic selection from striking-distance GSC data (same as before).

## Base44 BlogPost entity fields (content pipeline)
The **BlogPost** entity in Base44 must include: **`meta_title`** (text), **`meta_description`** (text), **`faq_schema`** (long text — stores the FAQ JSON-LD `<script type="application/ld+json">…</script>` string). Add or align these in the Base44 app before `createBlogPost` sends them from [`agent/lib/base44.js`](../agent/lib/base44.js); otherwise the API may reject unknown fields.

## Base44 SiteAudit, ContentAction, PlannedPost (content intelligence)
Align Base44 entities with payloads from [`agent/lib/base44.js`](../agent/lib/base44.js): **`SiteAudit`** — `brand`, `audit_date`, `summary`, `pillar_map`, `content_gaps`, `action_items`, `status` (`active` / `archived`). **`ContentAction`** — `brand`, `action_type`, `affected_urls`, `recommendation`, `reasoning`, `seo_impact`, `status`. **`PlannedPost`** — `brand`, `title`, `keyword`, `type`, `pillar`, `reasoning`, `estimated_impact`, `priority`, `status` (`planned`, `writing`, `written`). Nested JSON may need long-text or JSON columns depending on Base44 configuration.

## WordPress publish
Draft posts only (`status: 'draft'` via WP REST). **`POST /run/publish`** loads the `BlogPost` from Base44 and creates the WP draft; Base44 is updated with `wp_draft_url` and workflow status as implemented in the agent.

## Skills build order
Security scan first (no OAuth complexity), then GA4 (service account, simpler), then GSC (OAuth2 is the hard part), then content pipeline.

## Jobs: column name `type`
The `jobs` table uses **`type`** for job kind (e.g. skill routing). The dashboard Job Feed and agent logs use this column — not `job_type`.

## Docket brand on dashboard
Light theme only (no dark mode toggle). Colors and Lato per brand guidelines; documented in `ai/context.md`.

## Skill / SSH placeholders
`agent/skills/content-pipeline.js` implements the **weekly content pipeline** (sitemap, GSC striking distance, GA4, Claude, Base44 `BlogPost`, publish helper). `agent/skills/site-audit.js` implements the **monthly site audit** (full GSC 1–100, top 100 GA4 pages, Claude audit JSON, Base44 `SiteAudit` / `ContentAction` / `PlannedPost`). `agent/skills/cro-agent.js` implements the **CRO agent** (Docket money pages: GA4 `generate_lead` + sessions by device for two 14-day windows, Puppeteer screenshots, Claude with web search, Base44 `CROSnapshot` per page + one `CRORecommendation` per run). Other skill files under `agent/skills/` and `agent/lib/ssh.js`, when added, remain placeholders until those skills are implemented — do not remove them arbitrarily.

## CRO agent (Docket)
- **Docket only** for now (money pages on `https://www.yourdocket.com`). Bi-weekly cron: Mondays at 9:00 AM `America/New_York` when the day of month is 1–7 or 15–21 (`0 9 1-7,15-21 * 1`), plus manual `POST /run/cro`.
- **Screenshots:** `puppeteer-core` with system Chromium at `/usr/bin/chromium-browser` on the droplet (Linux). Local Windows dev against that path will not work without a different setup.
- **One recommendation per run:** Claude returns one JSON test idea per page; the agent persists the **single highest-priority** recommendation (`high` > `medium` > `low`) to Base44. **No Nelio** (or similar) API — humans implement tests manually.
- **Claude web search** must be enabled for the Anthropic API key / organization in the Claude Console, or CRO analysis calls will fail (errors logged to AgentLog; the main agent process must not crash).
- **Base44 `CROSnapshot`:** align fields with [`agent/lib/base44.js`](../agent/lib/base44.js) `createCROSnapshot`: `brand`, `page_path`, `page_name`, `snapshot_date` (YYYY-MM-DD, `America/New_York`), `mobile_sessions`, `mobile_conversions`, `mobile_rate`, `mobile_change_pct`, `desktop_*`, `tablet_*` (same pattern). Use numeric types where Base44 expects numbers; `mobile_change_pct` may be null when the prior period rate is undefined.
- **Base44 `CRORecommendation`:** `brand`, `page_path`, `page_name`, `observation`, `hypothesis`, `what_to_test`, `device_focus`, `priority`, `reasoning`, `status` (`pending` / `testing` / `completed` / `skipped`), `created_at` (YYYY-MM-DD ET).
