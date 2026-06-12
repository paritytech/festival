#!/usr/bin/env node
/**
 * Freeze a package's polkadot-app-deploy manifest into its build output.
 *
 * The reusable deploy workflow only ships the build artifact (it never checks
 * out this repo), so the manifest the CLI auto-discovers (by walking up from
 * the build dir) must live inside `out/`. The CLI also fails the deploy unless
 * `config.domain` matches the deploy domain, which differs per environment
 * (stg.*, bare, pr<N>-*).
 *
 * So we evaluate the package's source manifest with VITE_DOTNS_ID set to the
 * exact target domain and write a self-contained `out/polkadot-app-deploy.config.mjs`
 * with the domain baked in as a literal — no env vars or imports at deploy time.
 *
 * Usage: node scripts/emit-manifest.mjs <package-dir>
 *   e.g. node scripts/emit-manifest.mjs packages/attendee
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const pkgDir = process.argv[2]
if (!pkgDir) {
  console.error('Usage: node scripts/emit-manifest.mjs <package-dir>')
  process.exit(1)
}

const srcPath = resolve(pkgDir, 'polkadot-app-deploy.config.mjs')
const { default: config } = await import(pathToFileURL(srcPath).href)

if (!config?.domain) {
  console.error(`No domain resolved from ${srcPath} (is VITE_DOTNS_ID set?)`)
  process.exit(1)
}

const outPath = resolve(pkgDir, 'out', 'polkadot-app-deploy.config.mjs')
writeFileSync(outPath, `export default ${JSON.stringify(config, null, 2)}\n`)
console.log(`Wrote ${outPath} (domain: ${config.domain})`)
