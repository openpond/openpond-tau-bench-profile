#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
revision=672227c6b6676edc20d57ea53b7000262aae77b9
mkdir -p vendor
if [ ! -d vendor/tau2-bench/.git ]; then
  git clone https://github.com/sierra-research/tau2-bench.git vendor/tau2-bench
fi
if [ -n "$(git -C vendor/tau2-bench status --porcelain)" ]; then
  echo 'Upstream dependency has local changes; refusing to overwrite them.' >&2
  exit 1
fi
git -C vendor/tau2-bench checkout --detach "$revision"
bun install --frozen-lockfile
uv venv .venv --python 3.12 --allow-existing
uv pip sync --python .venv/bin/python requirements.lock
