#!/usr/bin/env bash
# Run the on-claude-stop.cjs integration tests
set -euo pipefail
cd "$(dirname "$0")"
node --test on-claude-stop.test.cjs
