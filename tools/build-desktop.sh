#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${PROJECT_ROOT}/tools/local-env.sh"

cd "${PROJECT_ROOT}"

npm run build -w @poker/desktop
