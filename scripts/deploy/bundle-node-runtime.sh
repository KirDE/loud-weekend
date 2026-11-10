#!/usr/bin/env bash
set -euo pipefail

runtime="${1:?usage: bundle-node-runtime.sh RUNTIME_DIRECTORY}"
expected_node="$(cat "$(dirname "$0")/../../.node-version")"
actual_node="$(node --version)"
if [[ "$actual_node" != "v$expected_node" ]]; then
  echo "Node runtime mismatch: expected v$expected_node, got $actual_node" >&2
  exit 1
fi
mkdir -p "$runtime"

cp "$(command -v node)" "$runtime/node"
chmod 0755 "$runtime/node"

npm_cli="$(readlink -f "$(command -v npm)")"
npm_root="$(dirname "$(dirname "$npm_cli")")"
test -f "$npm_root/bin/npm-cli.js"
cp -a "$npm_root" "$runtime/npm"
"$runtime/node" "$runtime/npm/bin/npm-cli.js" --version > "$runtime/NPM_VERSION"
