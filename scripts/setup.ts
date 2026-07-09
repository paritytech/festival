/**
 * Guided deploy.
 *
 *   npm run setup                            # interactive wizard
 *   npm run setup -- --network paseo-next-v2 --yes   # non-interactive
 *   npm run setup -- --dry-run               # checks only, no on-chain writes
 *
 * Phases: Environment → Configure → Readiness → Build → Deploy → Roles →
 * Build frontend → Publish. Accounts display as SS58 with the chain-mapped H160
 * in brackets (resolved from the account mapping, never derived locally).
 */

import dotenv from 'dotenv'
dotenv.config({ quiet: true })
dotenv.config({ path: 'contracts/.env', quiet: true })

import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { ss58ToH160 } from '@parity/product-sdk-address'

import * as ui from './lib/ui'
import { c } from './lib/ui'
import {
  checkTooling,
  checkRpcReachable,
  checkDeployerBalance,
  summarize,
  type CheckResult,
} from './lib/preflight'
import {
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG,
  BUILT_IN_NETWORKS,
  REPO_ROOT,
  accountFromSeed,
  readSecrets,
  resolveNetworkConfig,
  applyNetworkEnv,
  domainLabel,
  type DeployConfig,
  type Account,
} from './lib/config'
import { loadState, markDone, isDone } from './lib/state'
import { checkDotnsReadiness, resolveEvmAddress, popStatusName } from './lib/dotns-check'
import { upsertEnvFile } from './lib/env-files'
import type { NetworkConfig } from './lib/network'

// ── Flags ──

interface Flags {
  network?: string
  yes: boolean
  dryRun: boolean
  skipContracts: boolean
  skipFrontend: boolean
  skipDotnsCheck: boolean
  configPath?: string
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { yes: false, dryRun: false, skipContracts: false, skipFrontend: false, skipDotnsCheck: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--network' || a === '--env') flags.network = argv[++i]
    else if (a === '--yes' || a === '-y' || a === '--non-interactive') flags.yes = true
    else if (a === '--dry-run') flags.dryRun = true
    else if (a === '--skip-contracts') flags.skipContracts = true
    else if (a === '--skip-frontend') flags.skipFrontend = true
    else if (a === '--skip-dotns-check') flags.skipDotnsCheck = true
    else if (a === '--config') flags.configPath = argv[++i]
  }
  return flags
}

// ── Helpers ──

const short = (s: string) => (s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s)

/** Render "5Grw…utQY (0x3a1f…9c2d)". SS58 primary, mapped H160 in brackets. */
function fmtAccount(ss58: string, h160: `0x${string}` | null): string {
  return h160 ? `${short(ss58)} (${short(h160)})` : short(ss58)
}

function renderChecks(results: CheckResult[]): void {
  for (const r of results) {
    const line = r.detail ? `${r.label} ${c.dim('—')} ${r.detail}` : r.label
    if (r.status === 'ok') ui.success(line)
    else if (r.status === 'warn') ui.warn(line)
    else ui.error(line)
    if (r.status !== 'ok' && r.fix) ui.log(c.dim(`     ${r.fix}`))
  }
}

class BlockedError extends Error {}

// ── Phase A: Environment ──

function phaseEnvironment(): void {
  ui.heading('Environment')
  const tools = checkTooling()
  renderChecks(tools)
  if (summarize(tools).blocked) {
    throw new BlockedError('Environment check failed — install the missing tools above and re-run.')
  }
}

// ── Phase B: Configure ──

async function phaseConfigure(flags: Flags): Promise<{
  config: DeployConfig
  network: NetworkConfig
  deployer: Account
  publisher: Account
}> {
  ui.heading('Configure')

  const existing = loadConfig(flags.configPath)
  if (existing && !flags.yes) {
    ui.log(c.dim(`Found deploy.config.json (network: ${existing.network}).`))
  }

  const base: DeployConfig = existing ?? { ...DEFAULT_CONFIG }

  // Network
  let network = flags.network ?? base.network
  if (!flags.yes && !flags.network) {
    network = await ui.select('Target network', [
      ...BUILT_IN_NETWORKS.map((n) => ({
        label: n,
        value: n as string,
        hint: n === 'paseo-next-v2' ? 'recommended testnet' : undefined,
      })),
      { label: 'custom…', value: 'custom', hint: 'your own RPC + genesis + Bulletin RPC' },
    ])
  }

  const config: DeployConfig = {
    network,
    sessionsEnabled: true, // sessions are always enabled
    domains: { ...base.domains },
    custom: base.custom,
  }

  // Custom network details
  if (network === 'custom') {
    if (flags.yes) {
      if (!config.custom?.mainWsUrl) {
        throw new BlockedError('network "custom" requires a `custom` block in deploy.config.json (mainWsUrl).')
      }
    } else {
      const cu = config.custom ?? ({} as NonNullable<DeployConfig['custom']>)
      config.custom = {
        displayName: await ui.text('Custom network name', { default: cu.displayName || 'Custom network' }),
        mainWsUrl: await ui.text('Asset Hub WebSocket URL', {
          default: cu.mainWsUrl,
          validate: (v) => (v.startsWith('ws') ? null : 'must be a ws:// or wss:// URL'),
        }),
        mainGenesisHash: await ui.text('Main chain genesis hash (blank to auto-detect)', { default: cu.mainGenesisHash || '' }) || undefined,
        bulletinWsUrl: await ui.text('Bulletin WebSocket URL (blank if none)', { default: cu.bulletinWsUrl || '' }) || undefined,
        nativeSymbol: await ui.text('Native token symbol', { default: cu.nativeSymbol || 'UNIT' }),
        nativeDecimals: Number(await ui.text('Native token decimals', { default: String(cu.nativeDecimals ?? 12) })),
        dotnsPopRules:
          (await ui.text('DotNS PopRules address (optional — blank to skip DotNS checks)', { default: cu.dotnsPopRules || '' })) || undefined,
        dotnsRegistrar:
          (await ui.text('DotNS Registrar address (optional)', { default: cu.dotnsRegistrar || '' })) || undefined,
      }
      if (!config.custom.dotnsPopRules || !config.custom.dotnsRegistrar) {
        ui.warn('Custom network: no DotNS addresses given — personhood/ownership advisory will be skipped.')
      }
    }
  }

  // Domains
  if (!flags.yes) {
    config.domains.admin = await ui.text('Admin SPA DotNS domain', { default: config.domains.admin || '' })
    config.domains.attendee = await ui.text('Attendee SPA DotNS domain', { default: config.domains.attendee || '' })
  }

  // Resolve the effective NetworkConfig.
  const netConfig = resolveNetworkConfig(config)

  // Secrets → accounts
  const secrets = readSecrets()
  let deployerSeed = secrets.deployerSeed
  if (!deployerSeed) {
    if (flags.yes) throw new BlockedError('DEPLOYER_SEED is not set in .env (required in --yes mode).')
    deployerSeed = await ui.password('Deployer seed (12/24-word mnemonic)')
    if (!deployerSeed) throw new BlockedError('A deployer seed is required to deploy contracts.')
  } else {
    ui.success('Deployer seed loaded from .env')
  }

  let publisherSeed = process.env.DOTNS_MNEMONIC?.trim() || deployerSeed
  const samePublisher = publisherSeed === deployerSeed
  if (!samePublisher) ui.success('Publisher mnemonic loaded from .env (DOTNS_MNEMONIC)')

  const deployer = accountFromSeed(deployerSeed)
  const publisher = samePublisher ? deployer : accountFromSeed(publisherSeed)

  // Review
  ui.blank()
  ui.log(c.bold('Review'))
  ui.log(`  Network    ${netConfig.displayName} ${c.dim(`(${config.network})`)}`)
  ui.log(`  Deployer   ${short(deployer.ss58)}`)
  ui.log(`  Publisher  ${short(publisher.ss58)}${samePublisher ? c.dim(' (same as deployer)') : ''}`)
  ui.log(`  Domains    admin ${config.domains.admin || c.dim('(none)')} · attendee ${config.domains.attendee || c.dim('(none)')}`)
  ui.log(`  Sessions   enabled`)
  ui.blank()

  if (!flags.yes) {
    const proceed = await ui.confirm('Save to deploy.config.json and continue?', true)
    if (!proceed) throw new BlockedError('Aborted at configuration.')
  }
  const savedTo = saveConfig(config, flags.configPath)
  ui.success(`Saved ${c.dim(savedTo)}`)

  return { config, network: netConfig, deployer, publisher }
}

// ── Phase C: Readiness ──

async function phaseReadiness(
  ctx: { config: DeployConfig; network: NetworkConfig; deployer: Account; publisher: Account },
  flags: Flags,
): Promise<{ client: ReturnType<typeof createClient>; api: any; deployerH160: `0x${string}` | null }> {
  const { network, config, deployer, publisher } = ctx

  // Expose the network to the deploy modules' getNetworkConfig().
  applyNetworkEnv(config)

  ui.heading(`Readiness ${c.dim(`(${config.network})`)}`)

  const results: CheckResult[] = []

  // main blocks, bulletin warns.
  results.push(await checkRpcReachable(network.mainChain.wsUrl, 'Asset Hub RPC', { failStatus: 'block' }))
  if (network.bulletinChain) {
    results.push(await checkRpcReachable(network.bulletinChain.wsUrl, 'Bulletin RPC', { failStatus: 'warn' }))
  }

  // Connect (reused through deploy).
  const client = createClient(getWsProvider(network.mainChain.wsUrl))
  const api = client.getUnsafeApi()

  // Chain-mapped H160s for display; SS58 stays the primary identity.
  const deployerH160 = await resolveEvmAddress(api, deployer.ss58)
  const publisherH160 =
    publisher.ss58 === deployer.ss58 ? deployerH160 : await resolveEvmAddress(api, publisher.ss58)
  ui.log(`Deployer   ${fmtAccount(deployer.ss58, deployerH160)}`)
  if (publisher.ss58 !== deployer.ss58) ui.log(`Publisher  ${fmtAccount(publisher.ss58, publisherH160)}`)
  ui.blank()

  const faucetHint =
    network.nativeToken.symbol === 'PAS'
      ? `Fund ${deployer.ss58} on ${network.displayName} → https://faucet.polkadot.io/ (select "Paseo Asset Hub").`
      : undefined
  results.push(await checkDeployerBalance(api, deployer.ss58, network.nativeToken, faucetHint))

  // DotNS / personhood for the publisher. Advisory.
  const labels = [config.domains.admin, config.domains.attendee].map(domainLabel).filter(Boolean)
  if (labels.length) {
    if (!publisherH160) {
      ui.warn(`Publisher ${short(publisher.ss58)} not yet account-mapped — ownership/personhood validated at publish time.`)
    }
    // Custom chains supply their own DotNS addresses.
    const dotnsOverride =
      config.network === 'custom' && config.custom?.dotnsPopRules && config.custom?.dotnsRegistrar
        ? { popRules: config.custom.dotnsPopRules, registrar: config.custom.dotnsRegistrar }
        : null
    for (const label of labels) {
      try {
        const dr = await checkDotnsReadiness({
          api,
          ss58: publisher.ss58,
          label,
          networkKey: network.key,
          contracts: dotnsOverride,
        })
        if (!dr.supported) {
          ui.bullet(`${label}.dot — DotNS gating unavailable on this network (skipped)`)
          continue
        }
        const reqName = popStatusName(dr.requiredStatus)
        const userName = popStatusName(dr.userStatus)
        const ownership = dr.owned
          ? c.green('owned by you')
          : dr.available
            ? 'available'
            : `owned by ${short(dr.owner ?? '?')}`
        const pers = dr.meetsRequirement
          ? c.green(`personhood OK (${userName})`)
          : c.yellow(`personhood ${userName}, needs ${reqName}`)
        ui.bullet(`${label}.dot — ${ownership} · ${pers}`)
        if (!flags.skipDotnsCheck && (!dr.owned || !dr.meetsRequirement)) {
          results.push({
            id: `dotns-${label}`,
            label: `${label}.dot`,
            status: 'block',
            detail: !dr.owned ? 'not owned by publisher' : `personhood ${userName}, needs ${reqName}`,
            fix: 'Own the .dot domain and meet personhood, or re-run with --skip-dotns-check.',
          })
        }
      } catch {
        ui.bullet(`${label}.dot — DotNS check skipped (read failed)`)
      }
    }
  }

  ui.blank()
  renderChecks(results)
  const sum = summarize(results)
  ui.blank()
  ui.log(
    `${sum.ok} ok · ${sum.warn} advisor${sum.warn === 1 ? 'y' : 'ies'} · ${sum.block} blocker${sum.block === 1 ? '' : 's'}`,
  )

  if (sum.blocked) {
    client.destroy()
    throw new BlockedError('Readiness check failed — resolve the blockers above and re-run.')
  }

  if (!flags.yes && !flags.dryRun) {
    const go = await ui.confirm('Continue?', true)
    if (!go) {
      client.destroy()
      throw new BlockedError('Stopped at readiness.')
    }
  }

  return { client, api, deployerH160 }
}

// ── Phase D: Build contracts ──

function phaseBuildContracts(state: ReturnType<typeof loadState>, flags: Flags): void {
  ui.heading('Build contracts')
  if (flags.skipContracts) {
    ui.log(c.dim('skipped (--skip-contracts)'))
    return
  }
  if (isDone(state, 'contractsBuilt')) {
    ui.success('contracts already built (state) — skipping')
    return
  }
  // contracts/lib isn't committed — install it on a fresh clone before building.
  if (
    !existsSync(resolve(REPO_ROOT, 'contracts/lib/forge-std')) ||
    !existsSync(resolve(REPO_ROOT, 'contracts/lib/openzeppelin-contracts'))
  ) {
    const isp = ui.spinner('installing contract libraries (forge-std + OpenZeppelin)…')
    const ins = spawnSync('make', ['install'], { cwd: 'contracts', encoding: 'utf8' })
    if (ins.status !== 0) {
      isp.fail('contract library install failed')
      if (ins.stdout) process.stdout.write(ins.stdout)
      if (ins.stderr) process.stdout.write(ins.stderr)
      throw new BlockedError('`make install` failed — see output above (needs network access for `forge install`).')
    }
    isp.succeed('contract libraries installed')
  }
  const sp = ui.spinner('forge build + copy ABIs…')
  const r = spawnSync('make', ['copy-abis'], { cwd: 'contracts', encoding: 'utf8' })
  if (r.status !== 0) {
    sp.fail('contract build failed')
    if (r.stdout) process.stdout.write(r.stdout)
    if (r.stderr) process.stdout.write(r.stderr)
    throw new BlockedError('`make copy-abis` failed — see output above.')
  }
  sp.succeed('contracts built + ABIs copied')
  markDone(state, 'contractsBuilt')
}

// ── Phase E: Deploy ──

async function phaseDeploy(
  ctx: {
    config: DeployConfig
    network: NetworkConfig
    deployer: Account
    client: ReturnType<typeof createClient>
    api: any
  },
  state: ReturnType<typeof loadState>,
): Promise<void> {
  const { config, network, deployer, client, api } = ctx
  ui.heading(`Deploy contracts ${c.dim(`(${config.network})`)}`)

  // Deploy modules read NETWORK at import time → applyNetworkEnv already ran.
  const { deployFestivalContracts, deriveH160 } = await import('./deploy/deploy-festival')
  const { deployMulticall } = await import('./deploy/deploy-multicall')

  const h160 = deriveH160(deployer.publicKey)

  // Map account for pallet-revive interaction.
  // Mapped = pallet-revive OriginalAccount entry for the derived H160
  // (ss58ToH160 matches AccountId32Mapper). Was inkSdk.addressIsMapped.
  const isMapped =
    (await api.query.Revive.OriginalAccount.getValue(ss58ToH160(deployer.ss58))) != null
  if (!isMapped) {
    const sp = ui.spinner('mapping deployer account…')
    await api.tx.Revive.map_account().signAndSubmit(deployer.signer)
    sp.succeed('deployer account mapped')
  }

  // Multicall3
  if (isDone(state, 'multicall') && state.addresses.multicall) {
    ui.success(`Multicall3   ${state.addresses.multicall} ${c.dim('(state — skipped)')}`)
  } else {
    const sp = ui.spinner('deploying Multicall3…')
    const multicall = await deployMulticall({ api, signer: deployer.signer, ss58: deployer.ss58 })
    sp.succeed(`Multicall3   ${multicall}`)
    markDone(state, 'multicall', { multicall })
  }

  // Festival trio
  if (isDone(state, 'festival') && state.addresses.festival) {
    ui.success(`Festival     ${state.addresses.festival} ${c.dim('(state — skipped)')}`)
  } else {
    const sp = ui.spinner('deploying Festival POAP + Session POAP + Festival…')
    const { festivalAddr, festivalPoapAddr, sessionPoapAddr, sessionTemplateAddr } =
      await deployFestivalContracts({ api, signer: deployer.signer, ss58: deployer.ss58, h160 })
    sp.succeed(`Festival     ${festivalAddr}`)
    ui.log(`  FestivalPOAP ${festivalPoapAddr}`)
    ui.log(`  SessionPOAP  ${sessionPoapAddr}`)
    markDone(state, 'festival', {
      festival: festivalAddr,
      festivalPoap: festivalPoapAddr,
      sessionPoap: sessionPoapAddr,
      sessionTemplate: sessionTemplateAddr,
    })
  }

  // Write addresses into per-network env files for both SPAs.
  const addrs = state.addresses
  const writeFor = (spa: 'admin' | 'attendee', dotnsDomain: string) => {
    const updates: Record<string, string> = {
      VITE_NETWORK: network.key,
      VITE_FESTIVAL_ADDRESS: addrs.festival!,
      VITE_FESTIVAL_POAP_ADDRESS: addrs.festivalPoap!,
      VITE_SUB_EVENT_POAP_ADDRESS: addrs.sessionPoap!,
      VITE_MULTICALL_ADDRESS: addrs.multicall!,
    }
    if (dotnsDomain) updates.VITE_DOTNS_ID = dotnsDomain
    return upsertEnvFile(spa, network.key, updates)
  }
  ui.blank()
  ui.log('wrote addresses →')
  ui.log(`  ${c.dim(writeFor('admin', config.domains.admin))}`)
  ui.log(`  ${c.dim(writeFor('attendee', config.domains.attendee))}`)
}

// ── Phase F: Roles ──

async function phaseRoles(
  ctx: { config: DeployConfig; deployer: Account; client: ReturnType<typeof createClient>; api: any },
  state: ReturnType<typeof loadState>,
  flags: Flags,
): Promise<void> {
  ui.heading('Roles (optional)')
  if (flags.yes) {
    ui.log(c.dim('skipped (non-interactive) — grant later with `npm run grant-role`'))
    return
  }
  const grant = await ui.confirm('Grant VOLUNTEER_ROLE to a door-staff address now?', false)
  if (!grant) {
    ui.log(c.dim('skipped — grant later with `npm run grant-role`'))
    return
  }
  const grantee = await ui.text('Grantee address (SS58 or 0x H160)')
  if (!grantee) {
    ui.log(c.dim('no address given — skipped'))
    return
  }

  const { grantRole } = await import('./deploy/grant-festival-role')
  const { deriveH160 } = await import('./deploy/deploy-festival')
  const { AccountId } = await import('@polkadot-api/substrate-bindings')

  let granteeH160: `0x${string}`
  let label: string
  if (/^0x[0-9a-fA-F]{40}$/.test(grantee)) {
    granteeH160 = grantee.toLowerCase() as `0x${string}`
    label = '(raw H160)'
  } else {
    granteeH160 = deriveH160(AccountId(42).enc(grantee))
    label = grantee
  }

  await grantRole({
    api: ctx.api,
    signer: ctx.deployer.signer,
    ss58: ctx.deployer.ss58,
    festival: state.addresses.festival!,
    granteeH160,
    roleName: 'VOLUNTEER_ROLE',
    granteeLabel: label,
    skipConfirm: true,
  })
  markDone(state, 'rolesGranted')
}

// ── Phase G: Build frontend ──

function phaseBuildFrontend(
  ctx: { config: DeployConfig; network: NetworkConfig },
  state: ReturnType<typeof loadState>,
  flags: Flags,
): void {
  ui.heading('Build frontend (static)')
  if (flags.skipFrontend) {
    ui.log(c.dim('skipped (--skip-frontend)'))
    return
  }
  if (isDone(state, 'frontendBuilt')) {
    ui.success('frontend already built (state) — skipping')
    return
  }
  const { config, network } = ctx
  const spas: Array<{ spa: 'admin' | 'attendee'; domain: string }> = [
    { spa: 'admin', domain: config.domains.admin },
    { spa: 'attendee', domain: config.domains.attendee },
  ]
  for (const { spa, domain } of spas) {
    const sp = ui.spinner(`${spa}: nuxt generate…`)
    const build = spawnSync(
      'npm',
      ['run', '-w', `packages/${spa}`, 'build', '--', '--dotenv', `.env.${network.key}`],
      { encoding: 'utf8', env: { ...process.env, NITRO_PRESET: 'static' } },
    )
    if (build.status !== 0) {
      sp.fail(`${spa} build failed`)
      if (build.stdout) process.stdout.write(build.stdout)
      if (build.stderr) process.stdout.write(build.stderr)
      throw new BlockedError(`Frontend build for ${spa} failed — see output above.`)
    }
    // Freeze the deploy manifest with this SPA's domain.
    if (domain) {
      const man = spawnSync('node', ['scripts/deploy/emit-manifest.mjs', `packages/${spa}`], {
        encoding: 'utf8',
        env: { ...process.env, VITE_DOTNS_ID: domain },
      })
      if (man.status !== 0 && man.stderr) ui.warn(`${spa} manifest: ${man.stderr.trim()}`)
    } else {
      ui.warn(`${spa}: no DotNS domain set — manifest not frozen (set one to publish).`)
    }
    sp.succeed(`${spa} → packages/${spa}/out${domain ? c.dim(`  (${domain})`) : ''}`)
  }
  markDone(state, 'frontendBuilt')
}

// ── Phase H: Publish handoff ──

function writeGithubEnv(config: DeployConfig, network: NetworkConfig, state: ReturnType<typeof loadState>): string | null {
  const a = state.addresses
  if (!a.festival || !a.festivalPoap || !a.sessionPoap || !a.multicall) {
    ui.warn('contract addresses incomplete — skipping .github/env write')
    return null
  }
  const path = resolve(REPO_ROOT, '.github', `env.${network.key}`)
  const lines = [
    '# Generated by `npm run setup` — consumed by the .github/workflows deploy pipeline.',
    `VITE_NETWORK=${network.key}`,
    `VITE_FESTIVAL_ADDRESS=${a.festival ?? ''}`,
    `VITE_FESTIVAL_POAP_ADDRESS=${a.festivalPoap ?? ''}`,
    `VITE_SUB_EVENT_POAP_ADDRESS=${a.sessionPoap ?? ''}`,
    `VITE_MULTICALL_ADDRESS=${a.multicall ?? ''}`,
    `ADMIN_DOTNS_DOMAIN=${config.domains.admin}`,
    `ATTENDEE_DOTNS_DOMAIN=${config.domains.attendee}`,
    `BULLETIN_ENV=${network.key}`,
    '',
  ]
  writeFileSync(path, lines.join('\n'))
  return path
}

async function phasePublish(
  ctx: { config: DeployConfig; network: NetworkConfig },
  state: ReturnType<typeof loadState>,
  flags: Flags,
): Promise<void> {
  ui.heading('Publish to DotNS')
  const { config, network } = ctx

  const ghEnvPath = writeGithubEnv(config, network, state)
  if (!ghEnvPath) return
  ui.success(`wrote ${c.dim(ghEnvPath)}`)
  markDone(state, 'ciEnvWritten')

  if (config.network === 'custom') {
    ui.warn('Custom network: CI publish is not configured for custom chains.')
    ui.log(c.dim(`   Serve packages/{admin,attendee}/out yourself (e.g. npx serve packages/attendee/out).`))
    return
  }

  const hasGh = (() => {
    try {
      return spawnSync('gh', ['--version'], { encoding: 'utf8' }).status === 0
    } catch {
      return false
    }
  })()

  const printManual = () => {
    ui.log('To publish, in your fork:')
    ui.log(c.dim('   1) add repo secrets (all three are distinct accounts):'))
    ui.log(c.dim('        DOTNS_MNEMONIC     owns the .dot domains / publishes (required)'))
    ui.log(c.dim('        DEPLOYER_SEED      deploys the contracts'))
    ui.log(c.dim('        E2E_DEPLOYER_SEED  funds CI e2e test deploys (optional)'))
    ui.log(c.dim('   2) Actions → "Deploy" → Run workflow'))
    ui.log(c.dim('      or:  gh workflow run deploy.yml'))
  }

  if (hasGh && !flags.yes) {
    const go = await ui.confirm('Set repo secrets and trigger the Deploy workflow now?', false)
    if (!go) {
      printManual()
      return
    }
    const deployerSeed = process.env.DEPLOYER_SEED?.trim()
    const publisherSeed = process.env.DOTNS_MNEMONIC?.trim() || deployerSeed
    const setSecret = (name: string, val?: string) => {
      if (!val) return
      const r = spawnSync('gh', ['secret', 'set', name], { input: val, encoding: 'utf8' })
      if (r.status === 0) ui.success(`secret ${name} set`)
      else ui.warn(`could not set ${name}: ${(r.stderr || '').trim() || 'gh error'}`)
    }
    setSecret('DEPLOYER_SEED', deployerSeed)
    setSecret('DOTNS_MNEMONIC', publisherSeed)
    // Test-only; consumed by e2e.yml. Defaults to the deployer seed.
    setSecret('E2E_DEPLOYER_SEED', deployerSeed)
    const run = spawnSync('gh', ['workflow', 'run', 'deploy.yml'], { encoding: 'utf8' })
    if (run.status === 0) {
      ui.success('Deploy workflow triggered')
      ui.log(c.dim('   Watch: gh run watch   (or the Actions tab)'))
    } else {
      ui.warn(`could not trigger workflow: ${(run.stderr || '').trim() || 'gh error'}`)
      printManual()
    }
  } else {
    if (!hasGh) ui.log(c.dim('gh not found — manual steps:'))
    printManual()
  }
}

// ── Main ──

async function main() {
  const flags = parseFlags(process.argv.slice(2))

  ui.intro('  Festival System — Guided Deploy')
  ui.log(c.dim('check env → configure → deploy contracts → build frontend → publish'))
  ui.log(c.dim('prerequisites: a funded deployer account + two .dot domains you own (see DEPLOY.md)'))
  if (flags.dryRun) ui.log(c.yellow('  dry-run: phases A–C only, no on-chain writes'))

  phaseEnvironment()
  const ctx = await phaseConfigure(flags)
  const { client, api } = await phaseReadiness(ctx, flags)

  if (flags.dryRun) {
    client.destroy()
    ui.outro(c.green('Dry-run complete — environment, config, and readiness checked. No changes made.'))
    return
  }

  const state = loadState(ctx.config.network)

  try {
    phaseBuildContracts(state, flags)
    await phaseDeploy({ ...ctx, client, api }, state)
    await phaseRoles({ config: ctx.config, deployer: ctx.deployer, client, api }, state, flags)
  } finally {
    client.destroy()
  }

  phaseBuildFrontend(ctx, state, flags)
  await phasePublish(ctx, state, flags)

  const a = state.addresses
  ui.blank()
  ui.intro(c.green('  ✓ Deploy complete') + c.dim(`  — ${ctx.config.network}`))
  ui.log(`  Festival       ${a.festival ?? c.dim('—')}`)
  ui.log(`  FestivalPOAP   ${a.festivalPoap ?? c.dim('—')}`)
  ui.log(`  SessionPOAP    ${a.sessionPoap ?? c.dim('—')}`)
  ui.log(`  Multicall3     ${a.multicall ?? c.dim('—')}`)
  ui.blank()
  ui.log(c.bold('  Next steps'))
  ui.log(c.dim('   • Open the Admin app in the Polkadot Host → run "Setup festival" (name/dates/capacity).'))
  ui.log(c.dim('   • Grant volunteer roles:  npm run grant-role'))
  ui.log(c.dim('   • Re-deploy / resume:     npm run setup'))
  ui.outro(c.dim(`Saved: deploy.config.json · .deploy/state.${ctx.config.network}.json`))
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    if (err instanceof BlockedError) {
      ui.blank()
      ui.error(err.message)
      process.exit(1)
    }
    ui.blank()
    ui.error(`Unexpected error: ${err?.message || err}`)
    process.exit(1)
  })
}
