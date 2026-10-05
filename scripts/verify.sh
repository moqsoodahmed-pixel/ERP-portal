#!/usr/bin/env bash
# Runs the same checks as CI locally. Usage: ./scripts/verify.sh
set -euo pipefail
cd "$(dirname "$0")/.."
(cd backend && npm ci && npm run lint && npm test)
(cd frontend && npm ci && npm run lint && npm test && npm run build)
if git ls-files 2>/dev/null | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$'; then echo "A .env file is tracked!"; exit 1; fi
echo "All checks passed"
