#!/bin/bash
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/agent"
git checkout -- package.json package-lock.json
git pull
pm2 restart marketing-agent --update-env
pm2 restart marketing-agent-webhook --update-env
