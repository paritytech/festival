/**
 * Bulk-import a festival schedule from a JSON agenda.
 *
 * Reads the festival's CURRENT on-chain metadata, merges in schedule entries
 * built from an agenda JSON, re-uploads the blob to Bulletin Chain, and points
 * the Festival contract at the new CID via `updateCid`. Existing metadata
 * (name, venue map, image, etc.) is preserved — only `schedule` is touched.
 *
 * Entries are imported WITHOUT a venue location (`venueMarkerId`); assign pins
 * afterwards in the admin UI. The script also writes a stage→entry reference
 * map (docs/schedule-stage-map.json) so you know which room each talk is in
 * while assigning pins.
 *
 * Input shape: either a plain array of sessions, or a Gatsby page-data blob
 * with sessions at `result.data.agendaJson.sessions`. Each session:
 *   { id, title, startTime, endTime, stage, location, type, description,
 *     speakers: [{ name, company, role }] }
 * Times are naive ISO 8601 (no TZ) and are kept verbatim — the app interprets
 * them as Europe/Berlin local time (see parseFestivalDate).
 *
 * Usage:
 *   # 1. Preview only (default — no chain writes; writes a local preview file):
 *   DEPLOYER_SEED="…" npx tsx scripts/import-schedule.ts \
 *     --env paseo-next-v2 --festival 0xFestivalAddr
 *
 *   # 2. Actually publish (uploads to Bulletin + writes updateCid on-chain):
 *   DEPLOYER_SEED="…" npx tsx scripts/import-schedule.ts \
 *     --env paseo-next-v2 --festival 0xFestivalAddr --write
 *
 * Flags:
 *   --env <key>        Network key (paseo | paseo-next-v2 | previewnet). Also NETWORK=.
 *   --festival <0x..>  Festival contract address. Also FESTIVAL_ADDRESS=.
 *   --input <path>     Agenda JSON. Default: docs/page-data.json
 *   --mode merge|replace  merge = upsert by entry id (default); replace = drop old schedule.
 *   --skip-types a,b   Comma-separated session `type`s to exclude (e.g. break,music).
 *   --write            Perform the upload + on-chain updateCid. Omit for a dry run.
 *
 * Prerequisites:
 *   - DEPLOYER_SEED holds MANAGER_ROLE on the Festival (the creator does by default).
 *   - The signer's account is funded on the main chain and authorized on Bulletin.
 */

import dotenv from 'dotenv'
dotenv.config({ quiet: true })
dotenv.config({ path: 'contracts/.env', quiet: true })

import { createClient, Binary } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { ss58ToH160 } from '@parity/product-sdk-address'
import { encodeFunctionData, decodeFunctionResult } from 'viem'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getNetworkConfig } from './lib/network'
import { parseEnvFlag } from './lib/env-files'
import { createSigner, deriveH160, DRY_RUN_DEPOSIT, GAS_MULTIPLIER } from './deploy/deploy-festival'
import { ensureBulletinAuthorization, uploadToBulletin } from './e2e/bulletin-upload'
import { computeCid, cidToBytes32, bytes32ToCid } from '../packages/shared/metadata/cid'
import { FestivalABI } from '../packages/shared/contracts/abis'
import { parseFestivalDate } from '../packages/shared/utils/time'
import type { FestivalMetadata, ScheduleEntry } from '../packages/shared/metadata/schemas'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')

// ── CLI parsing ──

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

const cliEnv = parseEnvFlag(process.argv)
if (cliEnv) process.env.NETWORK = cliEnv

const FESTIVAL_ADDRESS = (flag('festival') ?? process.env.FESTIVAL_ADDRESS ?? '').toLowerCase() as `0x${string}`
const INPUT_PATH = resolve(REPO_ROOT, flag('input') ?? 'docs/page-data.json')
const MODE = (flag('mode') ?? 'merge') as 'merge' | 'replace'
const SKIP_TYPES = new Set((flag('skip-types') ?? '').split(',').map(s => s.trim()).filter(Boolean))
const WRITE = hasFlag('write')

// ── Source session shape ──

interface SourceSpeaker {
  name: string
  company?: string | null
  role?: string | null
}
interface SourceSession {
  id: string
  title: string
  startTime: string
  endTime: string
  stage?: string | null
  location?: string | null
  type?: string | null
  description?: string | null
  speakers?: SourceSpeaker[] | null
}

/** Pull the sessions array out of either a plain array or a Gatsby page-data blob. */
function extractSessions(raw: unknown): SourceSession[] {
  if (Array.isArray(raw)) return raw as SourceSession[]
  const nested = (raw as any)?.result?.data?.agendaJson?.sessions
  if (Array.isArray(nested)) return nested as SourceSession[]
  throw new Error(
    'Could not find a sessions array. Expected a top-level array or ' +
      '`result.data.agendaJson.sessions`.',
  )
}

function formatSpeaker(sp: SourceSpeaker): string {
  const name = (sp.name ?? '').trim()
  const extra = [sp.role, sp.company].filter(Boolean).join(', ')
  return extra ? `${name} (${extra})` : name
}

/** Map a source session → a clean ScheduleEntry (no venue location). */
function toScheduleEntry(s: SourceSession): ScheduleEntry {
  return {
    id: s.id,
    start: s.startTime,
    end: s.endTime,
    title: s.title,
    description: s.description ?? '',
    speakers: (s.speakers ?? []).map(formatSpeaker).filter(Boolean),
    // venueMarkerId intentionally omitted — assign pins in the admin UI later.
  }
}

// ── On-chain read (no forge build needed — uses the shared ABI) ──

/**
 * Normalise the `data` payload of a ReviveApi.call result to a hex string.
 * Depending on the runtime/metadata, PAPI surfaces it as a `Binary` (with
 * `.asHex()`), a `Uint8Array`, or a plain indexed byte object — handle all three.
 */
function resultDataToHex(data: unknown): `0x${string}` {
  if (!data) return '0x'
  if (typeof (data as any).asHex === 'function') return (data as any).asHex()
  const bytes = data instanceof Uint8Array ? data : Uint8Array.from(Object.values(data as Record<string, number>))
  return ('0x' + Buffer.from(bytes).toString('hex')) as `0x${string}`
}

async function readFestival(api: any, origin: string): Promise<{ metadataCid: `0x${string}`; startTime: bigint; endTime: bigint }> {
  const calldata = encodeFunctionData({ abi: FestivalABI as any, functionName: 'getEventDetails' })
  const dryRun = await api.apis.ReviveApi.call(
    origin,
    FESTIVAL_ADDRESS,
    0n,
    undefined,
    DRY_RUN_DEPOSIT,
    Binary.fromHex(calldata),
  )
  if (!dryRun.result.success || dryRun.result.value.flags & 1) {
    const detail = JSON.stringify(dryRun.result.value, (_k, v) => typeof v === 'bigint' ? v.toString() : v)
    throw new Error(`Festival.getEventDetails read failed: ${detail} — check the address + network.`)
  }
  const dataHex = resultDataToHex(dryRun.result.value.data)
  const decoded = decodeFunctionResult({ abi: FestivalABI as any, functionName: 'getEventDetails', data: dataHex }) as any[]
  return { metadataCid: decoded[0], startTime: decoded[4], endTime: decoded[5] }
}

/** Fetch + parse the current metadata JSON from the IPFS gateway. */
async function fetchMetadata(metadataCid: `0x${string}`, gateway: string): Promise<FestivalMetadata> {
  const cid = bytes32ToCid(metadataCid)
  const base = gateway.replace(/\/+$/, '').replace(/\/ipfs$/, '')
  const url = `${base}/ipfs/${cid.toString()}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch current metadata from ${url} (HTTP ${res.status})`)
  return (await res.json()) as FestivalMetadata
}

// ── On-chain write: updateCid ──

async function updateCid(api: any, signer: any, ss58: string, cidBytes32: `0x${string}`): Promise<string> {
  const calldata = encodeFunctionData({ abi: FestivalABI as any, functionName: 'updateCid', args: [cidBytes32] })

  let weightLimit: any
  let storageDepositLimit: bigint = DRY_RUN_DEPOSIT
  const dryRun = await api.apis.ReviveApi.call(
    ss58,
    FESTIVAL_ADDRESS,
    0n,
    undefined,
    DRY_RUN_DEPOSIT,
    Binary.fromHex(calldata),
  )
  if (dryRun.result.success && !(dryRun.result.value.flags & 1)) {
    weightLimit = {
      ref_time: dryRun.weight_required.ref_time * GAS_MULTIPLIER,
      proof_size: dryRun.weight_required.proof_size * GAS_MULTIPLIER,
    }
    if (dryRun.storage_deposit.type === 'Charge' && dryRun.storage_deposit.value > 0n) {
      storageDepositLimit = dryRun.storage_deposit.value * GAS_MULTIPLIER
    }
  } else {
    throw new Error(
      'updateCid dry-run reverted — the signer likely lacks MANAGER_ROLE on this festival.',
    )
  }

  const tx = api.tx.Revive.call({
    dest: FESTIVAL_ADDRESS,
    value: 0n,
    weight_limit: weightLimit,
    storage_deposit_limit: storageDepositLimit,
    data: Binary.fromHex(calldata),
  })
  const result = await tx.signAndSubmit(signer)
  if (!result.ok) {
    const errInfo = JSON.stringify(result.dispatchError, (_k: string, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    )
    throw new Error(`updateCid failed: ${errInfo}`)
  }
  return result.txHash as string
}

// ── Main ──

async function main() {
  if (!FESTIVAL_ADDRESS || FESTIVAL_ADDRESS === '0x') {
    throw new Error('Missing festival address. Pass --festival 0x… or set FESTIVAL_ADDRESS.')
  }

  const network = getNetworkConfig()
  if (!network.bulletinChain) {
    throw new Error(`Network ${network.key} has no bulletinChain — cannot upload metadata.`)
  }

  console.log('=== Schedule Bulk Import ===\n')
  console.log(`Network:   ${network.displayName} (${network.key})`)
  console.log(`Festival:  ${FESTIVAL_ADDRESS}`)
  console.log(`Input:     ${INPUT_PATH}`)
  console.log(`Mode:      ${MODE}${SKIP_TYPES.size ? `  (skipping types: ${[...SKIP_TYPES].join(', ')})` : ''}`)
  console.log(`Action:    ${WRITE ? 'WRITE (upload + updateCid)' : 'DRY RUN (preview only)'}\n`)

  // 1. Parse the agenda.
  const raw = JSON.parse(readFileSync(INPUT_PATH, 'utf8'))
  const sessions = extractSessions(raw).filter(s => !SKIP_TYPES.has(s.type ?? ''))
  const entries = sessions.map(toScheduleEntry)
  console.log(`Parsed ${entries.length} entries from ${INPUT_PATH}.`)

  // Derive the signer up front. Even the dry-run read needs a *mapped* origin
  // (pallet-revive rejects unmapped accounts with AccountUnmapped), and the
  // deployer — which created this festival — is guaranteed mapped. The same
  // signer performs the --write upload + updateCid.
  const { signer, publicKey, ss58 } = createSigner()
  const h160 = deriveH160(publicKey)

  // 2. Connect + read current on-chain metadata.
  console.log(`\nConnecting to ${network.mainChain.wsUrl} …`)
  const client = createClient(getWsProvider(network.mainChain.wsUrl))
  try {
    const api = client.getUnsafeApi()
    const { metadataCid, startTime, endTime } = await readFestival(api, ss58)
    console.log(`Current metadata CID: ${metadataCid}`)
    const metadata = await fetchMetadata(metadataCid, network.ipfsGateway)
    console.log(`Fetched current metadata: "${metadata.name}" (${metadata.schedule?.length ?? 0} existing entries).`)

    // 3. Bounds check (soft — schedule entries aren't on-chain-validated).
    const startSec = Number(startTime)
    const endSec = Number(endTime)
    const outOfBounds = entries.filter(e => {
      const s = Math.floor(parseFestivalDate(e.start).getTime() / 1000)
      const en = Math.floor(parseFestivalDate(e.end).getTime() / 1000)
      return s < startSec || en > endSec
    })
    if (startSec > 0 && outOfBounds.length) {
      console.warn(`\n⚠️  ${outOfBounds.length} entries fall outside the festival window:`)
      for (const e of outOfBounds.slice(0, 8)) console.warn(`    - ${e.start} → ${e.end}  ${e.title}`)
      if (outOfBounds.length > 8) console.warn(`    … and ${outOfBounds.length - 8} more`)
    }

    // 4. Merge.
    const existing = metadata.schedule ?? []
    let merged: ScheduleEntry[]
    if (MODE === 'replace') {
      merged = entries
    } else {
      const byId = new Map(existing.map(e => [e.id, e]))
      for (const e of entries) byId.set(e.id, e)
      merged = [...byId.values()]
    }
    merged.sort((a, b) => parseFestivalDate(a.start).getTime() - parseFestivalDate(b.start).getTime())
    metadata.schedule = merged
    console.log(`\nResulting schedule: ${merged.length} entries (was ${existing.length}).`)

    // 5. Stage reference map + grouped summary (for assigning pins later).
    const stageMap: Record<string, string> = {}
    const byStage = new Map<string, number>()
    for (const s of sessions) {
      const stage = s.stage ?? s.location ?? '(unspecified)'
      stageMap[s.id] = stage
      byStage.set(stage, (byStage.get(stage) ?? 0) + 1)
    }
    console.log('\nEntries by stage (assign one pin per stage afterwards):')
    for (const [stage, n] of [...byStage.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${stage}`)
    }
    const stageMapPath = resolve(REPO_ROOT, 'docs/schedule-stage-map.json')
    writeFileSync(stageMapPath, JSON.stringify(stageMap, null, 2))
    console.log(`\nWrote stage reference map → ${stageMapPath}`)

    // 6. Serialize + CID.
    const bytes = new TextEncoder().encode(JSON.stringify(metadata))
    const cid = await computeCid(bytes)
    const cidBytes32 = cidToBytes32(cid)
    console.log(`\nNew metadata size: ${bytes.length} bytes`)
    console.log(`New CID:    ${cid.toString()}`)
    console.log(`New bytes32: ${cidBytes32}`)

    // Always write a local preview of the full blob to inspect.
    const previewPath = resolve(REPO_ROOT, 'docs/festival-metadata.preview.json')
    writeFileSync(previewPath, JSON.stringify(metadata, null, 2))
    console.log(`Wrote full metadata preview → ${previewPath}`)

    if (!WRITE) {
      console.log('\nDRY RUN complete. Review the preview, then re-run with --write to publish.')
      return
    }

    // 7. Publish: upload to Bulletin, then point the contract at the new CID.
    console.log(`\nSigner SS58: ${ss58}`)
    console.log(`Signer H160: ${h160}`)

    // Ensure the signer is mapped for pallet-revive interaction.
    const isMapped = (await api.query.Revive.OriginalAccount.getValue(ss58ToH160(ss58))) != null
    if (!isMapped) {
      console.log('Mapping account to H160 …')
      await api.tx.Revive.map_account().signAndSubmit(signer)
    }

    console.log('\nUploading metadata to Bulletin Chain …')
    await ensureBulletinAuthorization(network.bulletinChain.wsUrl, ss58, signer, bytes.length)
    await uploadToBulletin(network.bulletinChain.wsUrl, bytes, signer)
    console.log('  Uploaded.')

    console.log('\nWriting updateCid on-chain …')
    const txHash = await updateCid(api, signer, ss58, cidBytes32)
    console.log(`  OK (tx: ${txHash})`)
    console.log('\n✅ Schedule published. Open the admin app to assign venue pins per entry.')
  } finally {
    client.destroy()
  }
}

main().catch(err => {
  console.error('\nImport failed:', err?.message || err)
  process.exit(1)
})
