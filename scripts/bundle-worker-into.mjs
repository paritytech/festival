#!/usr/bin/env node
/**
 * Build the announcements chat worker into a host product's deploy output.
 *
 * Only the attendee product declares a `worker` modality (see
 * `packages/attendee/polkadot-app-deploy.config.mjs`); for any other app this is a
 * no-op. The worker build reads the same `VITE_*` env as the SPA build (this
 * process's env), so it targets the matching Festival + network. We then copy
 * the bundle to `<app>/out/worker/index.js` — the path the manifest's worker
 * executable points at.
 *
 * Run after the app build (which regenerates `out/`), before `emit-manifest.mjs`:
 *   node scripts/bundle-worker-into.mjs <app>   (e.g. attendee)
 */
import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const app = process.argv[2]
if (app !== 'attendee') {
  console.log(`[bundle-worker] "${app ?? '(none)'}" has no worker modality — skipping.`)
  process.exit(0)
}

const root = resolve(import.meta.dirname, '..')
const src = resolve(root, 'packages/announcements-worker/dist/worker/index.js')
const destDir = resolve(root, 'packages/attendee/out/worker')

console.log('[bundle-worker] building @festival/announcements-worker …')
execSync('npm run -w packages/announcements-worker build', { cwd: root, stdio: 'inherit' })

mkdirSync(destDir, { recursive: true })
copyFileSync(src, resolve(destDir, 'index.js'))
console.log(`[bundle-worker] wrote ${resolve(destDir, 'index.js')}`)
