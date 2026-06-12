/**
 * E2E test-festival orchestrator.
 *
 * Pipeline (linear, single deployer signer except for one Bob-signed flag):
 *   1. Build a windowed FestivalMetadata blob → compute CID.
 *   2. HEAD-probe the IPFS gateway; if missing, upload to Bulletin.
 *   3. Deploy Festival + POAPs + orphan FestivalSession (existing flow).
 *   4. Configure: setup() + grantRole × {Bob, Alice} × {ADMIN, MANAGER, VOLUNTEER}
 *      + manualCheckIn × {deployer, Bob, Alice}.
 *   5. Deployer createSession() (so Bob is NOT the creator → favorite-toggle
 *      stays reachable in attendee tests).
 *   6. Fund Bob with ~1 native + map his account.
 *   7. Bob signs one session.flag() so the moderation banner + flag badge
 *      tests have non-zero flagCount.
 *   8. Stream VITE_* keys to stdout (captured by CI's `>> $GITHUB_ENV`).
 *
 * Usage:
 *   DEPLOYER_SEED="…" npx tsx scripts/deploy-test-festival.ts --env paseo-next-v2
 */

// stdout is piped to $GITHUB_ENV by the workflow. Keep it strictly KEY=value.
// dotenv 17 prints diagnostic chatter on import; silence with quiet:true.
import dotenv from 'dotenv'
dotenv.config({ quiet: true })
dotenv.config({ path: 'contracts/.env', quiet: true })

import { createClient, Binary } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { ss58ToH160 } from '@parity/product-sdk-address'
import { keccak256, toBytes, encodeFunctionData, decodeFunctionResult } from 'viem'

import { getNetworkConfig } from '../lib/network'
import { parseEnvFlag } from '../lib/env-files'
import {
  createSigner,
  deriveH160,
  deployFestivalContracts,
  callContract,
  loadArtifact,
  DRY_RUN_DEPOSIT,
} from '../deploy/deploy-festival'
import { makeTestAccount } from './test-accounts'
import { buildChannelMetadata, buildSessionMetadata, buildWindowedMetadata } from './test-metadata'
import { ensureBulletinAuthorization, isBlobOnIpfs, uploadToBulletin } from './bulletin-upload'
import { computeCid, cidToBytes32 } from '../../packages/shared/metadata/cid'

const cliEnv = parseEnvFlag(process.argv)
if (cliEnv) process.env.NETWORK = cliEnv

const DEFAULT_ADMIN_ROLE =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`
const MANAGER_ROLE = keccak256(toBytes('MANAGER_ROLE'))
const VOLUNTEER_ROLE = keccak256(toBytes('VOLUNTEER_ROLE'))

const SESSION_CREATED_TOPIC = keccak256(
  toBytes('SessionCreated(address,address,bytes32)'),
)

function asHexString(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (v && typeof (v as any).asHex === 'function') return (v as any).asHex()
  if (v instanceof Uint8Array) return '0x' + Buffer.from(v).toString('hex')
  return undefined
}

/**
 * Parse the `SessionCreated(address sessionAddr, address creator, bytes32 cid)`
 * event from Festival's logs. Pallet-revive surfaces Solidity events as
 * `Revive.ContractEmitted` (not `Instantiated`), so this is how we recover the
 * deployed child-contract address from `createSession()`'s tx result.
 *
 * Topic[0] = keccak256("SessionCreated(address,address,bytes32)").
 * Topic[1] = padded sessionAddr (last 20 bytes of the 32-byte topic).
 */
function extractSessionCreatedAddress(
  events: unknown[],
  festivalAddr: string,
): `0x${string}` | undefined {
  for (const event of events as any[]) {
    if (event?.type !== 'Revive') continue
    if (event?.value?.type !== 'ContractEmitted') continue
    const inner = event.value.value
    if (!inner) continue
    const contract = asHexString(inner.contract)?.toLowerCase()
    if (contract !== festivalAddr.toLowerCase()) continue
    const topics = inner.topics ?? []
    const topic0 = asHexString(topics[0])?.toLowerCase()
    if (topic0 !== SESSION_CREATED_TOPIC.toLowerCase()) continue
    const topic1 = asHexString(topics[1])
    if (!topic1) continue
    return ('0x' + topic1.replace(/^0x/, '').slice(-40)) as `0x${string}`
  }
  return undefined
}

async function readContractAddress(
  contractAddress: `0x${string}`,
  contractName: string,
  functionName: string,
  args: unknown[],
  api: any,
  origin: string,
): Promise<`0x${string}`> {
  const { abi } = loadArtifact(contractName)
  const calldata = encodeFunctionData({ abi, functionName, args })
  const dryRun = await api.apis.ReviveApi.call(
    origin,
    contractAddress.toLowerCase(),
    0n,
    undefined,
    DRY_RUN_DEPOSIT,
    Binary.fromHex(calldata),
  )
  if (!dryRun.result.success || dryRun.result.value.flags & 1) {
    throw new Error(`${contractName}.${functionName} read failed`)
  }
  const dataHex = (dryRun.result.value.data?.asHex?.() ??
    '0x') as `0x${string}`
  const decoded = decodeFunctionResult({
    abi,
    functionName,
    data: dataHex,
  }) as `0x${string}`
  return decoded
}

async function main() {
  const network = getNetworkConfig()
  if (!network.bulletinChain) {
    throw new Error(
      `Network ${network.key} has no bulletinChain — e2e seed needs one to upload metadata`,
    )
  }

  console.error('=== E2E Test Festival Seed ===\n')
  console.error(`Network: ${network.displayName}\n`)

  // 1. Identities
  const {
    signer: deployerSigner,
    publicKey: deployerPub,
    ss58: deployerSs58,
  } = createSigner()
  const deployerH160 = deriveH160(deployerPub)
  const bob = makeTestAccount('bob')
  const alice = makeTestAccount('alice')

  console.error(`Deployer SS58:  ${deployerSs58}`)
  console.error(`Deployer H160:  ${deployerH160}`)
  console.error(`Alice SS58:     ${alice.ss58}`)
  console.error(`Alice H160:     ${alice.h160}`)
  console.error(`Bob SS58:       ${bob.ss58}`)
  console.error(`Bob H160:       ${bob.h160}\n`)

  // 2. Metadata + CID
  const metaWindow = buildWindowedMetadata()
  console.error(
    `Window: ${new Date(Number(metaWindow.startSec) * 1000).toISOString()} → ${new Date(
      Number(metaWindow.endSec) * 1000,
    ).toISOString()}`,
  )
  const cid = await computeCid(metaWindow.bytes)
  const cidBytes32 = cidToBytes32(cid)
  console.error(`CID:            ${cid.toString()}`)
  console.error(`bytes32 digest: ${cidBytes32}\n`)

  // 3. Bulletin upload (skipped if already pinned).
  //    Personhood is bootstrapped once via the standalone
  //    https://sudo.personhood.dev/personhood-faucet tool. The bulletin storage
  //    allowance is *not* granted there. It's claimed separately via
  //    `TransactionStorage.authorize_account`, which the deployer submits
  //    themselves (their PoP credential gates the call). See
  //    scripts/e2e/bulletin-upload.ts.
  console.error('=== Bulletin upload ===')
  const alreadyOnIpfs = await isBlobOnIpfs(network.ipfsGateway, cid)
  if (alreadyOnIpfs) {
    console.error('  Blob already at gateway — skipping upload.\n')
  } else {
    // Alice (//Alice from the dev phrase) is the bulletin authority on
    // paseo-next-v2. Same pattern as bulletin-deploy/src/pool.ts and
    // polkadot-bulletin-chain/examples/authorize_and_store_papi.js. She
    // submits `authorize_account({ who: deployer, ... })`; the deployer
    // then signs `store`.
    console.error(`  Ensuring bulletin authorization for ${deployerSs58}...`)
    await ensureBulletinAuthorization(
      network.bulletinChain.wsUrl,
      deployerSs58,
      alice.signer,
      metaWindow.bytes.length,
    )
    console.error(
      `  Uploading ${metaWindow.bytes.length} bytes to ${network.bulletinChain.wsUrl}...`,
    )
    await uploadToBulletin(
      network.bulletinChain.wsUrl,
      metaWindow.bytes,
      deployerSigner,
    )
    console.error('  Upload finalized.\n')
  }

  // 3b. Empty-channel metadata upload. Festival.setup() now requires a
  //     channel CID (one announcement channel per festival, registered
  //     atomically with the festival). Mirrors useFestivalCreate's
  //     "initial empty channel" pattern.
  const channelBytes = buildChannelMetadata().bytes
  const channelCid = await computeCid(channelBytes)
  const channelCidBytes32 = cidToBytes32(channelCid)
  console.error('=== Channel metadata upload ===')
  console.error(`Channel CID:    ${channelCid.toString()}`)
  console.error(`bytes32 digest: ${channelCidBytes32}\n`)
  const channelAlreadyOnIpfs = await isBlobOnIpfs(network.ipfsGateway, channelCid)
  if (channelAlreadyOnIpfs) {
    console.error('  Channel blob already at gateway — skipping upload.\n')
  } else {
    console.error(`  Ensuring bulletin authorization for ${deployerSs58}...`)
    await ensureBulletinAuthorization(
      network.bulletinChain.wsUrl,
      deployerSs58,
      alice.signer,
      channelBytes.length,
    )
    console.error(
      `  Uploading ${channelBytes.length} bytes to ${network.bulletinChain.wsUrl}...`,
    )
    await uploadToBulletin(
      network.bulletinChain.wsUrl,
      channelBytes,
      deployerSigner,
    )
    console.error('  Channel upload finalized.\n')
  }

  // 3c. Session metadata upload. The community session MUST point at its own
  //     SubEventMetadata blob (string `location`), NOT the festival CID.
  //     Reusing the festival CID makes the session resolve to a festival
  //     document whose object `location` crashes the attendee map's
  //     session-strip path on marker select.
  const session = buildSessionMetadata()
  const sessionCid = await computeCid(session.bytes)
  const sessionCidBytes32 = cidToBytes32(sessionCid)
  console.error('=== Session metadata upload ===')
  console.error(`Session CID:    ${sessionCid.toString()}`)
  console.error(`bytes32 digest: ${sessionCidBytes32}\n`)
  const sessionAlreadyOnIpfs = await isBlobOnIpfs(network.ipfsGateway, sessionCid)
  if (sessionAlreadyOnIpfs) {
    console.error('  Session blob already at gateway — skipping upload.\n')
  } else {
    console.error(`  Ensuring bulletin authorization for ${deployerSs58}...`)
    await ensureBulletinAuthorization(
      network.bulletinChain.wsUrl,
      deployerSs58,
      alice.signer,
      session.bytes.length,
    )
    console.error(
      `  Uploading ${session.bytes.length} bytes to ${network.bulletinChain.wsUrl}...`,
    )
    await uploadToBulletin(
      network.bulletinChain.wsUrl,
      session.bytes,
      deployerSigner,
    )
    console.error('  Session upload finalized.\n')
  }

  // 4. Connect to main chain
  console.error(`Connecting to ${network.mainChain.wsUrl}...\n`)
  const client = createClient(getWsProvider(network.mainChain.wsUrl))
  const api = client.getUnsafeApi()

  try {
    // 5. Map deployer if needed. Mapped = pallet-revive OriginalAccount entry
    // for the account's derived H160 (ss58ToH160 matches AccountId32Mapper).
    // Was inkSdk.addressIsMapped.
    const isDeployerMapped =
      (await api.query.Revive.OriginalAccount.getValue(ss58ToH160(deployerSs58))) != null
    if (!isDeployerMapped) {
      console.error('Mapping deployer account...')
      await api.tx.Revive.map_account().signAndSubmit(deployerSigner)
      console.error('  Mapped.\n')
    }

    // 6. Deploy contracts
    const { festivalAddr, festivalPoapAddr, sessionPoapAddr } =
      await deployFestivalContracts({
        api,
        signer: deployerSigner,
        ss58: deployerSs58,
        h160: deployerH160,
      })

    // 7. setup()
    console.error('\n=== Configuring Festival ===\n')
    await callContract(
      festivalAddr,
      'Festival',
      'setup',
      [cidBytes32, channelCidBytes32, metaWindow.startSec, metaWindow.endSec, 1000],
      api,
      deployerSigner,
      deployerSs58,
    )

    // 8. grantRole × Bob, Alice
    console.error('\n=== Granting roles ===\n')
    for (const acc of [bob, alice]) {
      for (const role of [DEFAULT_ADMIN_ROLE, MANAGER_ROLE, VOLUNTEER_ROLE]) {
        await callContract(
          festivalAddr,
          'Festival',
          'grantRole',
          [role, acc.h160],
          api,
          deployerSigner,
          deployerSs58,
        )
      }
    }

    // 9. manualCheckIn × deployer, Bob, Alice
    //    AttendancePOAP._nextTokenId starts at 1 (id 0 is a no-token sentinel),
    //    so the POAPs are:
    //      deployer → #1 (used by deployer's createSession call below)
    //      bob      → #2 (used by Bob's flag() call below)
    //      alice    → #3
    console.error('\n=== Checking in accounts ===\n')
    for (const targetH160 of [deployerH160, bob.h160, alice.h160]) {
      await callContract(
        festivalAddr,
        'Festival',
        'manualCheckIn',
        [targetH160],
        api,
        deployerSigner,
        deployerSs58,
      )
    }

    // 10. createSession() as deployer (so Bob is NOT the session creator,
    //     keeping the attendee favorite-toggle reachable in tests).
    console.error('\n=== Creating session ===\n')
    const sStart = metaWindow.startSec + 3600n
    const sEnd = sStart + 1800n
    const sessionResult = await callContract(
      festivalAddr,
      'Festival',
      'createSession',
      [sessionCidBytes32, sStart, sEnd, 1n],
      api,
      deployerSigner,
      deployerSs58,
    )

    // Parse SessionCreated from the createSession tx's ContractEmitted logs.
    // Pallet-revive surfaces Solidity events as Revive.ContractEmitted (10 of
    // them on the last run. No Revive.Instantiated for the child contract).
    const sessionAddr = extractSessionCreatedAddress(sessionResult.events, festivalAddr)
    if (!sessionAddr) {
      throw new Error(
        'Could not find SessionCreated event in createSession tx — event types: ' +
          JSON.stringify(
            (sessionResult.events as any[]).map((e) => ({
              type: e?.type,
              valueType: e?.value?.type,
            })),
          ),
      )
    }
    console.error(`  Session at: ${sessionAddr}`)

    // 11. Fund Bob (auto-mapping happens on his first signed tx if missing;
    //     but pallet-revive on some builds wants an explicit map first, so
    //     we send `Revive.map_account` from Bob right after funding).
    console.error('\n=== Funding Bob ===\n')
    const fundAmount = 10n ** BigInt(network.nativeToken.decimals) // ~1 native
    const fundResult = await api.tx.Balances.transfer_keep_alive({
      dest: { type: 'Id', value: bob.ss58 } as any,
      value: fundAmount,
    }).signAndSubmit(deployerSigner)
    if (!fundResult.ok) {
      throw new Error(
        `Bob funding tx failed: ${JSON.stringify(fundResult.dispatchError)}`,
      )
    }
    console.error('  Funded.\n')

    const isBobMapped =
      (await api.query.Revive.OriginalAccount.getValue(ss58ToH160(bob.ss58))) != null
    if (!isBobMapped) {
      console.error('Mapping Bob account...')
      const mapResult = await api.tx.Revive.map_account().signAndSubmit(
        bob.signer,
      )
      if (!mapResult.ok) {
        throw new Error(
          `Bob map_account failed: ${JSON.stringify(mapResult.dispatchError)}`,
        )
      }
      console.error('  Mapped.\n')
    }

    // 12. Bob flags the deployer's session.
    //     Bob's festival POAP token id = 2 (deterministic from check-in order
    //     above, with POAP._nextTokenId starting at 1).
    console.error('=== Bob flags session ===\n')
    await callContract(
      sessionAddr,
      'FestivalSession',
      'flag',
      [2n],
      api,
      bob.signer,
      bob.ss58,
    )

    // 13. Emit env keys for `>> $GITHUB_ENV` capture.
    console.error('\n=== Seed Complete ===\n')
    process.stdout.write(`VITE_FESTIVAL_ADDRESS=${festivalAddr}\n`)
    process.stdout.write(`VITE_FESTIVAL_POAP_ADDRESS=${festivalPoapAddr}\n`)
    process.stdout.write(`VITE_SUB_EVENT_POAP_ADDRESS=${sessionPoapAddr}\n`)
  } finally {
    client.destroy()
  }
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message || err)
  process.exit(1)
})
