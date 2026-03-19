# Project Context

## What This Is
A custom AI agent system for Docket and ServiceCore marketing operations. An agent runs on a DigitalOcean droplet, performs automated tasks (security scans, SEO pulls, content generation), writes results to Supabase, and a Next.js dashboard on Vercel displays everything live with a chat interface.

## Tech Stack
- Agent: Node.js + PM2 on DigitalOcean droplet
- Database: Supabase (Postgres + Realtime) — https://umvmnardjwaguswwzxad.supabase.co
- Dashboard: Next.js deployed to Vercel
- AI: Anthropic API (claude-sonnet-4-6)
- Image gen: Gemini Imagen (imagen-4.0-generate-001)
- SSH: node-ssh

## Three Skills
1. Security Scan — SSH into 5 WPMU DEV hosts, run WP Defender, write results to scan_results table
2. SEO Intelligence — Pull GA4 + GSC data for Docket and ServiceCore, write to seo_snapshots table
3. Content Pipeline — Generate blog topics → approval workflow → write WP drafts

## Hard Rules
- Never publish WordPress posts — always status: 'draft'
- Never fix/quarantine/delete anything on production during security scans (read-only)
- service_role Supabase key = server only, never browser
- Credentials always in .env — never hardcoded
- Always timezone: 'America/New_York' in node-cron
- GSC requires OAuth2 — service accounts do NOT work

## Repo Structure
One repo, two folders: /dashboard (deploys to Vercel) and /agent (runs on DO droplet)
