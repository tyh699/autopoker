#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/tools/local-env.sh"

cd "${PROJECT_ROOT}"

echo "==> npm install"
npm install --no-audit --no-fund

echo "==> build shared"
npm run build -w @poker/shared

echo "==> typecheck server/web"
npm run typecheck -w @poker/server
npm run typecheck -w @poker/web

echo "==> build server/web"
npm run build -w @poker/server
npm run build -w @poker/web

echo "==> tests"
npm run test -w @poker/server
npm run test -w @poker/web

echo "All checks passed."
