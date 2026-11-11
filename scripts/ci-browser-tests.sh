#!/usr/bin/env bash
set -euo pipefail

# All browsers and OS libraries come from the digest-pinned Playwright image.
# Node is mounted from setup-node, matching application/production .node-version.
export PATH="/node-runtime/bin:$PATH"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
expected_node="v$(cat .node-version)"
[[ "$(node --version)" == "$expected_node" ]] || { echo 'Browser job Node version mismatch' >&2; exit 1; }
npm ci
# Fail early if a dependency update no longer matches the image's browser bundle.
node --input-type=module - <<'JS'
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
const version = JSON.parse(readFileSync('node_modules/@playwright/test/package.json', 'utf8')).version;
if (version !== process.env.PLAYWRIGHT_IMAGE_VERSION) throw new Error('Playwright image/package versions differ');
if (!existsSync(chromium.executablePath())) throw new Error('Preinstalled Chromium missing');
JS
npx prisma migrate deploy
npm run test:seed
# Preserve the full suite, including auth/roles, maps, locale and mobile checks.
npm run test:admin:e2e
