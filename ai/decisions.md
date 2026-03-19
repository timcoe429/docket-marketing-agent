# Decisions

## Single repo, two folders
One GitHub repo with /dashboard and /agent subfolders. Simpler to manage than two repos.

## Dashboard before agent
Build the dashboard first — it's the testing surface. Can't meaningfully test the agent without visibility into what it's doing.

## RLS disabled on Supabase
Private internal tool. RLS adds complexity with no benefit here.

## DigitalOcean droplet for agent
Needs persistent cron jobs and SSH access. Vercel serverless can't do either.

## Skills build order
Security scan first (no OAuth complexity), then GA4 (service account, simple), then GSC (OAuth2 is the anno
