/**
 * Bulletin chain upload helpers for the e2e seed script.
 *
 * Authorization model on paseo-next-v2 (verified against
 * polkadot-bulletin-chain/runtimes/bulletin-paseo/src/storage.rs):
 *
 *   type Authorizer = EitherOfDiverse<
 *     EitherOfDiverse<
 *       EitherOfDiverse<
 *         EnsureRoot,                            // sudo / governance
 *         EnsureXcm<IsSiblingParachain>,         // LTS-claim via People chain
 *       >,
 *       EnsureSignedBy<TestAccounts>,            // Alice + EXTRA_AUTHORIZER
 *     >,
 *     EnsureAllowedAuthorizers,                  // accounts in `AllowedAuthorizers`
 *   >;
 *
 * `TestAccounts` on the paseo runtime is `[Alice, EXTRA_AUTHORIZER]`
 * (storage.rs:53-58), so Alice's `authorize_account` is accepted by
 * `EnsureSignedBy<TestAccounts>`. The pallet's `consume_authorizer_budget`
 * short-circuits with `Ok(())` when the signer has no entry in
 * `AllowedAuthorizers` (lib.rs:2400). Alice qualifies but is unmetered.
 *
 * We use raw PAPI here (not the bulletin SDK's `authorizeAccount`
 * wrapper) so that we (a) wait for finalization not best-block, (b) inspect
 * the dispatch result for silent on-chain failures, and (c) read the raw
 * storage value to confirm the post-state.
 */

import type { CID } from 'multiformats/cid'
import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import type { PolkadotSigner } from 'polkadot-api/signer'

const GRANT_TRANSACTIONS = 100
const GRANT_BYTES = 10n * 1024n * 1024n

// An authorization is expired when `now >= expiration` (types.rs:129). The
// seed makes up to three sequential finalized uploads against one grant, so
// require the grant to outlive the whole run: ~50 blocks ≈ 5 min at 6s blocks.
const EXPIRY_MARGIN_BLOCKS = 50

/**
 * HEAD-probe the gateway. 200 → blob is reachable, skip upload.
 */
export async function isBlobOnIpfs(
  gatewayUrl: string,
  cid: CID,
  timeoutMs = 5_000,
): Promise<boolean> {
  const url = `${gatewayUrl.replace(/\/+$/, '')}/ipfs/${cid.toString()}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

interface AuthSnapshot {
  raw: unknown
  remainingBytes: bigint
  remainingTransactions: number
  expiration: number
  currentBlock: number
  expired: boolean
}

async function readAuthorization(api: any, address: string): Promise<AuthSnapshot> {
  const [raw, currentBlock] = await Promise.all([
    api.query.TransactionStorage.Authorizations.getValue({
      type: 'Account',
      value: address,
    }),
    api.query.System.Number.getValue().then(Number),
  ])
  if (!raw || !raw.extent) {
    return {
      raw,
      remainingBytes: 0n,
      remainingTransactions: 0,
      expiration: 0,
      currentBlock,
      expired: true,
    }
  }
  const ext = raw.extent
  const expiration = Number(raw.expiration ?? 0)
  // The runtime rejects `store` from an expired auth with Invalid.Payment
  // (check_authorization, lib.rs:2073), so a grant that expires mid-run is as
  // good as none — report zero remaining so callers re-authorize.
  const expired = currentBlock + EXPIRY_MARGIN_BLOCKS >= expiration
  const txAllowance = Number(ext.transactions_allowance ?? 0)
  const txConsumed = Number(ext.transactions ?? 0)
  const bytesAllowance = BigInt(ext.bytes_allowance ?? 0n)
  const bytesConsumed = BigInt(ext.bytes ?? 0n)
  return {
    raw,
    remainingBytes: expired ? 0n : bytesAllowance - bytesConsumed,
    remainingTransactions: expired ? 0 : txAllowance - txConsumed,
    expiration,
    currentBlock,
    expired,
  }
}

function summariseAuth(snap: AuthSnapshot): string {
  if (!snap.raw) return 'no authorization entry'
  if (snap.expired) {
    return (
      `expired/expiring authorization (expiration block ${snap.expiration}, ` +
      `current block ${snap.currentBlock}) — treating as no allowance`
    )
  }
  return `${snap.remainingTransactions} txs / ${snap.remainingBytes} bytes remaining`
}

function isStaleNonceError(err: unknown): boolean {
  // PAPI v2 surfaces `TransactionValidityError::Invalid(Stale)` as either
  // `{ type: 'Invalid', value: { type: 'Stale' } }` or a stringified form in
  // err.message. Concurrent admin+attendee CI jobs both racing Alice's nonce
  // hit this when one wins the block first. By then the other's storage
  // pre-check is already stale, and they re-submit with the same nonce.
  const obj = err as any
  if (obj?.type === 'Invalid' && obj?.value?.type === 'Stale') return true
  const msg: string =
    typeof obj?.message === 'string' ? obj.message : String(err ?? '')
  return /"type":\s*"Stale"|Invalid.*Stale|Stale.*Invalid/i.test(msg)
}

/**
 * Ensure `address` has a bulletin storage allowance ≥ `byteSize`. If
 * insufficient, `authoritySigner` (Alice / TestAccounts on paseo-next-v2)
 * submits `TransactionStorage.authorize_account({ who, transactions, bytes })`
 * and we verify the post-state by re-reading storage at the finalized block.
 *
 * Concurrency-safe: when admin + attendee CI jobs race Alice's nonce, one
 * wins; the other catches the `InvalidTransaction::Stale` error, re-reads
 * storage, and proceeds if the winner's grant already covers our needs.
 */
export async function ensureBulletinAuthorization(
  bulletinWsUrl: string,
  address: string,
  authoritySigner: PolkadotSigner,
  byteSize: number,
): Promise<void> {
  const client = createClient(getWsProvider(bulletinWsUrl))
  try {
    const api = client.getUnsafeApi()

    const pre = await readAuthorization(api, address)
    console.error(`  pre-auth: ${summariseAuth(pre)}`)
    if (pre.remainingBytes >= BigInt(byteSize) && pre.remainingTransactions > 0) {
      console.error('  Sufficient existing allowance — skipping authorize.')
      return
    }

    console.error(
      `  Submitting authorize_account(${address}, ${GRANT_TRANSACTIONS} txs, ${GRANT_BYTES} bytes)...`,
    )
    const tx = api.tx.TransactionStorage.authorize_account({
      who: address,
      transactions: GRANT_TRANSACTIONS,
      bytes: GRANT_BYTES,
    })

    let submitError: unknown
    try {
      const result = await tx.signAndSubmit(authoritySigner)
      if (!result.ok) {
        const errInfo = JSON.stringify(result.dispatchError, (_k, v) =>
          typeof v === 'bigint' ? v.toString() : v,
        )
        throw new Error(`authorize_account dispatched with error: ${errInfo}`)
      }
      console.error(
        `  authorize_account finalized at ${result.block?.hash ?? '?'} (tx ${result.txHash})`,
      )
    } catch (err) {
      if (!isStaleNonceError(err)) throw err
      console.error(
        '  authorize_account got Stale — concurrent CI job likely won the race; ' +
          'rechecking storage for landed grant.',
      )
      submitError = err
    }

    // If we got Stale, wait a couple of blocks for the winning job's tx to
    // finalize before reading storage. Otherwise read immediately.
    if (submitError) await new Promise((r) => setTimeout(r, 12_000))

    const post = await readAuthorization(api, address)
    console.error(`  post-auth: ${summariseAuth(post)}`)
    if (post.remainingBytes < BigInt(byteSize) || post.remainingTransactions <= 0) {
      if (submitError) {
        throw new Error(
          `authorize_account hit Stale and post-recheck still shows insufficient ` +
            `allowance — concurrent job's grant didn't land in time. Raw: ${JSON.stringify(
              post.raw,
              (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
            )}`,
        )
      }
      throw new Error(
        `authorize_account finalized OK but post-check still shows insufficient ` +
          `allowance for ${address} — raw storage: ${JSON.stringify(
            post.raw,
            (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
          )}`,
      )
    }
  } finally {
    client.destroy()
  }
}

export async function uploadToBulletin(
  bulletinWsUrl: string,
  data: Uint8Array,
  signer: PolkadotSigner,
): Promise<void> {
  const client = createClient(getWsProvider(bulletinWsUrl))
  try {
    const api = client.getUnsafeApi()
    const tx = api.tx.TransactionStorage.store({ data })
    const result = await tx.signAndSubmit(signer)
    if (!result.ok) {
      const errInfo = JSON.stringify(result.dispatchError, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      )
      throw new Error(`TransactionStorage.store failed: ${errInfo}`)
    }
  } finally {
    client.destroy()
  }
}
