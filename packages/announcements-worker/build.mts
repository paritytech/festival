/**
 * Worker build — esbuild bundle with the target environment baked in.
 *
 * Resolves the Festival + network from the same `VITE_*` env the attendee app
 * builds with (`VITE_FESTIVAL_ADDRESS`, `VITE_NETWORK`, optional genesis
 * overrides), reusing `@festival/shared`'s network registry as the single
 * source of truth, and inlines them via esbuild `define`. So a build for any
 * environment (PR preview, previewnet, staging, prod) targets the matching
 * Festival + chain, exactly like the SPA.
 *
 * The import of `networks` here is build-time only (run under tsx in Node); it
 * is NOT bundled into the worker — the worker never imports `@festival/shared`
 * at runtime (constraint B: keep the bundle lean).
 *
 * Run with: `tsx build.mts` (see package.json `build`).
 */
import { build } from 'esbuild'
import { resolveNetwork } from '../shared/host/networks'

const network = process.env.VITE_NETWORK || 'paseo-next-v2'
const net = resolveNetwork(network, {
  mainGenesisHash: process.env.VITE_CHAIN_GENESIS_HASH,
  bulletinGenesisHash: process.env.VITE_BULLETIN_GENESIS_HASH,
})
const festival =
  process.env.VITE_FESTIVAL_ADDRESS || '0xe4e3a76a4ccae0c8bbdd7472f2f766ab2f9890df'

/**
 * dotNS host the worker deeplinks into. Inherits the attendee app's
 * `VITE_DOTNS_ID` (the worker only bundles into attendee). Dev values
 * (localhost/ports) aren't `.dot` hosts → '' → deeplink buttons no-op.
 */
function toDotHost(raw: string): string {
  const host = raw
    .trim()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
  return /\.dot(\.li)?$/.test(host) ? host : ''
}

const dotns = toDotHost(process.env.VITE_DOTNS_ID || '')

await build({
  entryPoints: ['worker/index.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  outfile: 'dist/worker/index.js',
  // No IPFS gateway is injected: the worker reads every blob through the host
  // (constraint A). There is intentionally no gateway URL anywhere in the bundle.
  define: {
    'process.env.WORKER_FESTIVAL_ADDRESS': JSON.stringify(festival),
    'process.env.WORKER_CHAIN_GENESIS': JSON.stringify(net.mainChain.genesisHash),
    'process.env.WORKER_DOTNS_ID': JSON.stringify(dotns),
  },
})

console.log(
  `[build] network=${network} festival=${festival} ` +
    `genesis=${net.mainChain.genesisHash.slice(0, 12)}… dotns=${dotns || '(unset)'}`,
)
