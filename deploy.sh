#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/agent"
git pull
npm install
pm2 restart marketing-agent --update-env
