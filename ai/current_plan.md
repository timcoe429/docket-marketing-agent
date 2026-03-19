# Current Plan

## Status: Phase 0 Complete — Starting Phase 1 (Dashboard)

## Done
- [x] Supabase project created (https://umvmnardjwaguswwzxad.supabase.co)
- [x] Schema SQL run — all 5 tables created (jobs, scan_results, seo_snapshots, content_topics, chat_messages)
- [x] Realtime enabled on all tables
- [x] RLS disabled on all tables
- [x] GitHub repo created, cloned locally, opened in Cursor
- [x] Folder structure scaffolded
- [x] AI context files filled in

## In Progress
- [ ] Dashboard — Next.js scaffold inside /dashboard

## Up Next
1. Initialize Next.js in /dashboard
2. Install @supabase/supabase-js
3. Wire up Supabase client with anon key
4. Build dashboard shell with 4 tabs (Security, SEO, Content, Chat)
5. Wire up Realtime job feed (reads from jobs table, live updates)
6. Deploy to Vercel

## After Dashboard
- Agent skeleton in /agent
- Smoke test: agent inserts a job → dashboard shows it live
- Then skills one at a time: Security → GA4 → GSC → Content Pipeline
