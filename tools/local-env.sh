#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export RUSTUP_HOME="${PROJECT_ROOT}/.tools/rustup"
export CARGO_HOME="${PROJECT_ROOT}/.tools/cargo"
export CARGO_TARGET_DIR="${PROJECT_ROOT}/.tools/target"
export HOME="${PROJECT_ROOT}"
export RUSTUP_DIST_SERVER="https://rsproxy.cn"
export RUSTUP_UPDATE_ROOT="https://rsproxy.cn/rustup"

export PATH="${PROJECT_ROOT}/.tools/node/current/bin:${PROJECT_ROOT}/.tools/cargo/bin:${PATH}"

echo "Loaded local toolchain from ${PROJECT_ROOT}/.tools"
echo "node: $(node -v 2>/dev/null || echo missing)"
echo "npm:  $(npm -v 2>/dev/null || echo missing)"
echo "cargo: $(cargo --version 2>/dev/null || echo missing)"
