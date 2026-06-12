/**
 * Preflight checks. Environment checks (tool versions) need no inputs; readiness
 * checks (RPC reachability, deployer funding) need the resolved config. Each
 * returns a structured result; only `block` results stop the run.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { formatUnits } from 'viem'

export type CheckStatus = 'ok' | 'warn' | 'block'

export interface CheckResult {
  id: string
  label: string
  status: CheckStatus
  /** Short value/detail shown after the label. */
  detail?: string
  /** Actionable remediation, shown when status is warn/block. */
  fix?: string
}

// ── Environment (no inputs) ──

function cmdVersion(cmd: string, args: string[] = ['--version']): string | null {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8' })
    if (r.status !== 0 || r.error) return null
    return (r.stdout || r.stderr || '').trim().split('\n')[0] || ''
  } catch {
    return null
  }
}

function parseNodeMajorMinor(v: string): [number, number] {
  const m = v.replace(/^v/, '').split('.')
  return [Number(m[0]) || 0, Number(m[1]) || 0]
}

const MIN_NODE: [number, number] = [20, 19]

/** Tool-version checks. No inputs required. Safe to run first. */
export function checkTooling(): CheckResult[] {
  const results: CheckResult[] = []

  // Node
  const [maj, min] = parseNodeMajorMinor(process.versions.node)
  const nodeOk = maj > MIN_NODE[0] || (maj === MIN_NODE[0] && min >= MIN_NODE[1])
  results.push({
    id: 'node',
    label: 'Node',
    status: nodeOk ? 'ok' : 'block',
    detail: `v${process.versions.node}`,
    fix: nodeOk ? undefined : `Node ≥ ${MIN_NODE[0]}.${MIN_NODE[1]} required. Upgrade Node and re-run.`,
  })

  // npm
  const npm = cmdVersion('npm')
  results.push({
    id: 'npm',
    label: 'npm',
    status: npm ? 'ok' : 'block',
    detail: npm ?? undefined,
    fix: npm ? undefined : 'npm not found on PATH.',
  })

  // forge (Foundry)
  const forge = cmdVersion('forge')
  results.push({
    id: 'forge',
    label: 'forge / foundry',
    status: forge ? 'ok' : 'block',
    detail: forge ?? undefined,
    fix: forge ? undefined : 'Install Foundry: https://getfoundry.sh  (then `foundryup`).',
  })

  // git
  const git = cmdVersion('git')
  results.push({
    id: 'git',
    label: 'git',
    status: git ? 'ok' : 'block',
    detail: git ?? undefined,
    fix: git ? undefined : 'git not found on PATH.',
  })

  // gh (optional)
  const gh = cmdVersion('gh')
  results.push({
    id: 'gh',
    label: 'gh (GitHub CLI)',
    status: gh ? 'ok' : 'warn',
    detail: gh ?? 'not found',
    fix: gh ? undefined : 'Optional — without it the publish step prints manual steps instead of triggering CI.',
  })

  // contracts/lib isn't committed, so a fresh clone lacks it; the build phase installs it. Advisory.
  const libsPresent =
    existsSync('contracts/lib/forge-std') && existsSync('contracts/lib/openzeppelin-contracts')
  results.push({
    id: 'contract-libs',
    label: 'contract libs',
    status: 'ok',
    detail: libsPresent ? 'present' : 'will auto-install on build',
  })

  return results
}

// ── Readiness (needs config) ──

/**
 * Open a throwaway WebSocket to confirm the RPC is reachable and measure
 * round-trip-to-open latency. Uses Node's global WebSocket (no deps).
 */
export function checkRpcReachable(
  wsUrl: string,
  label: string,
  opts: { failStatus?: CheckStatus; timeoutMs?: number } = {},
): Promise<CheckResult> {
  const failStatus = opts.failStatus ?? 'block'
  const timeoutMs = opts.timeoutMs ?? 8000
  const start = Date.now()
  return new Promise((resolve) => {
    let done = false
    const finish = (status: CheckStatus, detail: string, fix?: string) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      resolve({ id: `rpc:${label}`, label: `${label} reachable`, status, detail, fix })
    }
    const timer = setTimeout(
      () => finish(failStatus, `${label} unreachable (timeout ${timeoutMs}ms)`, `Check the URL / your connection: ${wsUrl}`),
      timeoutMs,
    )
    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl)
    } catch {
      finish(failStatus, `${label} unreachable (bad URL?)`, wsUrl)
      return
    }
    ws.onopen = () => finish('ok', `${wsUrl}  (${Date.now() - start} ms)`)
    ws.onerror = () => finish(failStatus, `${label} unreachable`, `Check the URL / your connection: ${wsUrl}`)
  })
}

/**
 * Read the deployer's native balance. Zero balance is a hard block (deploy
 * can't proceed). `api` is a pallet-revive unsafe API (client.getUnsafeApi()).
 */
export async function checkDeployerBalance(
  api: any,
  ss58: string,
  nativeToken: { symbol: string; decimals: number },
  faucetHint?: string,
): Promise<CheckResult> {
  try {
    const account = await api.query.System.Account.getValue(ss58)
    const free: bigint = account?.data?.free ?? 0n
    const human = formatUnits(free, nativeToken.decimals)
    if (free === 0n) {
      return {
        id: 'balance',
        label: 'Deployer funded',
        status: 'block',
        detail: `balance 0 ${nativeToken.symbol}`,
        fix: faucetHint ?? `Fund the deployer account ${ss58} with ${nativeToken.symbol}, then re-run.`,
      }
    }
    return {
      id: 'balance',
      label: 'Deployer funded',
      status: 'ok',
      detail: `${human} ${nativeToken.symbol}`,
    }
  } catch (err) {
    return {
      id: 'balance',
      label: 'Deployer funded',
      status: 'warn',
      detail: `could not read balance (${err instanceof Error ? err.message : String(err)})`,
      fix: 'Balance check skipped — verify funding manually if the deploy fails.',
    }
  }
}

/** Tally results by severity. */
export function summarize(results: CheckResult[]): {
  ok: number
  warn: number
  block: number
  blocked: boolean
} {
  let ok = 0
  let warn = 0
  let block = 0
  for (const r of results) {
    if (r.status === 'ok') ok++
    else if (r.status === 'warn') warn++
    else block++
  }
  return { ok, warn, block, blocked: block > 0 }
}
