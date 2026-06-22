<script setup lang="ts">
import { ref } from 'vue'
import { navigateTo } from '#app'

// Dev-only page. Redirect to home in production
const isDev = import.meta.dev
if (!isDev) {
  navigateTo('/', { replace: true })
}
import { toHex, fromHex } from 'polkadot-api/utils'
import { useWalletStore } from '@festival/shared/host/wallet'
import { useMainClient } from '@festival/shared/host/client'
import { isInHost } from '@festival/shared/host/detect'
import { DOTNS_ID } from '@festival/shared/host/constants'
import { computeCid, cidToBytes32 } from '@festival/shared/metadata/cid'
import {
  requestCameraPermission,
  requestRemoteAccess,
  checkChainSupported,
} from '@festival/shared/host/permissions'
import { getPreimageManager } from '@parity/product-sdk-host'
import {
  sendNotification,
  pushNotification,
  cancelNotification,
  SCHEDULE_LIMIT_REACHED,
  type NotificationId,
} from '@festival/shared/host/notifications'
import { CHAIN_GENESIS_HASH, IPFS_GATEWAY } from '@festival/shared/host/constants'

const wallet = useWalletStore()

interface LogEntry {
  id: number
  time: string
  test: string
  status: 'pending' | 'success' | 'error'
  message: string
}

let logId = 0
const logs = ref<LogEntry[]>([])

function log(test: string, status: LogEntry['status'], message: string) {
  const entry: LogEntry = {
    id: ++logId,
    time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    test,
    status,
    message,
  }
  logs.value.unshift(entry)
  return entry.id
}

function updateLog(id: number, status: LogEntry['status'], message: string) {
  const entry = logs.value.find(l => l.id === id)
  if (entry) {
    entry.status = status
    entry.message = message
  }
}

// ── Test: Environment Info ──────────────────────────────────────
async function testEnvironment() {
  const id = log('Environment', 'pending', 'Checking...')
  try {
    const inHost = isInHost()
    const address = wallet.address
    const connected = wallet.isConnected
    updateLog(id, 'success', [
      `isInHost: ${inHost}`,
      `wallet.address: ${address || '(none)'}`,
      `wallet.isConnected: ${connected}`,
      `wallet.accountName: ${wallet.accountName}`,
    ].join('\n'))
  } catch (e: any) {
    updateLog(id, 'error', e.message)
  }
}

// ── Test: Feature Check ─────────────────────────────────────────
async function testFeatureCheck() {
  const id = log('Feature Check', 'pending', `Checking chain ${CHAIN_GENESIS_HASH.slice(0, 16)}...`)
  try {
    const supported = await checkChainSupported(CHAIN_GENESIS_HASH)
    updateLog(id, supported ? 'success' : 'error', `Chain supported: ${supported}`)
  } catch (e: any) {
    updateLog(id, 'error', e.message)
  }
}

// ── Test: Permissions ───────────────────────────────────────────
async function testPermissionCamera() {
  const id = log('Permission: Camera', 'pending', 'Requesting...')
  try {
    const granted = await requestCameraPermission()
    updateLog(id, granted ? 'success' : 'error', `Camera: ${granted ? 'granted' : 'denied'}`)
  } catch (e: any) {
    updateLog(id, 'error', e.message)
  }
}

async function testPermissionRemote() {
  const id = log('Permission: Remote', 'pending', 'Requesting...')
  try {
    const host = new URL(IPFS_GATEWAY).hostname
    const granted = await requestRemoteAccess([host])
    updateLog(id, granted ? 'success' : 'error', `Remote(${host}): ${granted ? 'granted' : 'denied'}`)
  } catch (e: any) {
    updateLog(id, 'error', e.message)
  }
}

// ── Test: System.remark (non-product account signer) ────────────
async function testSystemRemark() {
  const id = log('System.remark', 'pending', 'Preparing transaction...')
  try {
    if (!wallet.isConnected) {
      updateLog(id, 'error', 'Wallet not connected')
      return
    }

    const signer = wallet.getSigner()
    const { api } = await useMainClient()

    updateLog(id, 'pending', [
      `Signer publicKey: ${toHex(signer.publicKey)}`,
      `Wallet address (SS58): ${wallet.address}`,
    ].join('\n'))

    updateLog(id, 'pending', 'Creating remark transaction...')
    const tx = api.tx.System.remark({
      remark: new TextEncoder().encode(`host-updates test ${Date.now()}`),
    })

    updateLog(id, 'pending', 'Signing and submitting...')
    await new Promise<void>((resolve, reject) => {
      tx.signSubmitAndWatch(signer).subscribe({
        next: (event: any) => {
          updateLog(id, 'pending', `Event: ${event.type}`)
          if (event.type === 'txBestBlocksState' && event.found) {
            updateLog(id, 'success', `Included in block! txHash: ${event.txHash}`)
            resolve()
          } else if (event.type === 'finalized') {
            updateLog(id, 'success', `Finalized! txHash: ${event.txHash}`)
            resolve()
          }
        },
        error: (e: any) => {
          reject(e)
        },
      })
    })
  } catch (e: any) {
    updateLog(id, 'error', e.message)
  }
}

// ── Test: hostApi.createTransaction (alternative signing path) ──
async function testCreateTransaction() {
  const id = log('createTransaction', 'pending', 'Testing hostApi.createTransaction...')
  try {
    if (!wallet.isConnected) {
      updateLog(id, 'error', 'Wallet not connected')
      return
    }

    const { getTruApi } = await import('@parity/product-sdk-host')
    const hostApi = await getTruApi()
    if (!hostApi) {
      updateLog(id, 'error', 'Host API unavailable')
      return
    }
    const { api } = await useMainClient()

    updateLog(id, 'pending', 'Encoding System.remark calldata...')
    const tx = api.tx.System.remark({
      remark: new TextEncoder().encode(`createTransaction test ${Date.now()}`),
    })
    const encodedCall = await tx.getEncodedData()
    const callDataHex = toHex(encodedCall) as `0x${string}`
    updateLog(id, 'pending', `Calldata: ${callDataHex.slice(0, 40)}... (${callDataHex.length / 2 - 1} bytes)`)

    updateLog(id, 'pending', `Creating transaction for ${DOTNS_ID}...`)
    // The createTransaction v1 request is a flat object (no
    // version/signer:null/context tuple) with raw-byte callData/genesisHash.
    const result = await hostApi.createTransaction({
      tag: 'v1',
      value: {
        signer: [DOTNS_ID, 0],
        genesisHash: fromHex(CHAIN_GENESIS_HASH),
        callData: fromHex(callDataHex),
        extensions: [],
        txExtVersion: 0,
      },
    })

    result.match(
      (res: any) => {
        const txHex = toHex(res.value)
        updateLog(id, 'success', [
          'Transaction created and signed!',
          `Signed tx: ${txHex.slice(0, 60)}... (${txHex.length / 2 - 1} bytes)`,
        ].join('\n'))
      },
      (err: any) => {
        updateLog(id, 'error', JSON.stringify(err.value, null, 2))
      },
    )
  } catch (e: any) {
    updateLog(id, 'error', e.message || JSON.stringify(e))
  }
}

// ── Test: signRaw ───────────────────────────────────────────────
async function testSignRaw() {
  const id = log('signRaw', 'pending', 'Signing raw message...')
  try {
    if (!wallet.isConnected) {
      updateLog(id, 'error', 'Wallet not connected')
      return
    }

    const message = 'Hello from host-updates debug!'
    const hexMessage = toHex(new TextEncoder().encode(message))
    const signature = await wallet.signRaw(hexMessage)
    updateLog(id, 'success', `Signature: ${signature.slice(0, 40)}...`)
  } catch (e: any) {
    updateLog(id, 'error', e.message)
  }
}

// ── Test: Contract Read ─────────────────────────────────────────
async function testContractRead() {
  const id = log('Contract Read', 'pending', 'Reading contract with wallet address as origin...')
  try {
    const { api } = await useMainClient()
    const address = wallet.address || '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'

    updateLog(id, 'pending', `Querying System.Account for ${address.slice(0, 12)}...`)
    const account = await api.query.System.Account.getValue(address)
    const free = account?.data?.free ?? 0n
    updateLog(id, 'success', `Balance: ${free} (free)`)
  } catch (e: any) {
    updateLog(id, 'error', e.message)
  }
}

// ── Test: PreimageManager Submit + Lookup ────────────────────────
async function testPreimage() {
  const id = log('Preimage', 'pending', 'Testing submit + lookup...')
  try {
    if (!isInHost()) {
      updateLog(id, 'error', 'PreimageManager only works in host mode')
      return
    }

    const testData = JSON.stringify({ test: true, ts: Date.now() })
    const dataBytes = new TextEncoder().encode(testData)

    // Compute our CID for comparison.
    const ourCid = await computeCid(dataBytes)
    const ourBytes32 = cidToBytes32(ourCid)

    updateLog(id, 'pending', `Submitting ${dataBytes.length} bytes...`)
    const manager = await getPreimageManager()
    if (!manager) {
      updateLog(id, 'error', 'Preimage manager unavailable — not running inside a host container')
      return
    }
    const preimageHash = await manager.submit(dataBytes)

    updateLog(id, 'pending', `Submitted! Hash: ${preimageHash.slice(0, 30)}...\nOur CID bytes32: ${ourBytes32.slice(0, 30)}...\nMatch: ${preimageHash === ourBytes32}`)

    updateLog(id, 'pending', 'Looking up via PreimageManager.lookup...')
    const retrieved = await new Promise<Uint8Array | null>((resolve) => {
      const timeout = setTimeout(() => {
        sub.unsubscribe()
        resolve(null)
      }, 10_000)

      const sub = manager.lookup(preimageHash, (data) => {
        clearTimeout(timeout)
        sub.unsubscribe()
        resolve(data ?? null)
      })
    })

    if (retrieved) {
      const decoded = new TextDecoder().decode(retrieved)
      updateLog(id, 'success', [
        `Submit hash: ${preimageHash}`,
        `Our CID bytes32: ${ourBytes32}`,
        `Hash match: ${preimageHash === ourBytes32}`,
        `Lookup: ${decoded.slice(0, 100)}`,
      ].join('\n'))
    } else {
      updateLog(id, 'error', [
        `Submit hash: ${preimageHash}`,
        `Our CID bytes32: ${ourBytes32}`,
        `Hash match: ${preimageHash === ourBytes32}`,
        `Lookup: TIMEOUT (no data returned in 10s)`,
      ].join('\n'))
    }
  } catch (e: any) {
    updateLog(id, 'error', e.message)
  }
}

// ── Test: Bulletin Storage Round-trip (storePlaintext → retrievePlaintext) ──
async function testBulletinRoundTrip() {
  const id = log('Bulletin Round-trip', 'pending', 'Testing storePlaintext → retrievePlaintext...')
  try {
    const { useBulletinStorage } = await import('@festival/shared/metadata/bulletin')
    const storage = useBulletinStorage()

    const testPayload = { debugTest: true, ts: Date.now(), message: 'round-trip test' }

    updateLog(id, 'pending', `Storing via storePlaintext (isInHost: ${isInHost()})...`)
    const { cid, bytes32 } = await storage.storePlaintext(testPayload)
    updateLog(id, 'pending', `Stored! CID: ${cid.slice(0, 30)}...\nbytes32: ${bytes32.slice(0, 30)}...`)

    updateLog(id, 'pending', 'Retrieving via retrievePlaintext(bytes32)...')
    const retrieved = await storage.retrievePlaintext<typeof testPayload>(bytes32)

    updateLog(id, 'success', [
      `Store path: ${isInHost() ? 'preimageManager' : 'bulletin chain'}`,
      `Retrieve path: ${isInHost() ? 'preimageManager' : 'IPFS fetch'}`,
      `CID: ${cid.slice(0, 40)}...`,
      `bytes32: ${bytes32}`,
      `Retrieved: ${JSON.stringify(retrieved).slice(0, 150)}`,
      `Match: ${JSON.stringify(retrieved) === JSON.stringify(testPayload)}`,
    ].join('\n'))
  } catch (e: any) {
    updateLog(id, 'error', e.message || JSON.stringify(e))
  }
}

// ── Test: Retrieve existing CID (pre-migration data) ────────────
async function testRetrieveExistingCid() {
  const id = log('Retrieve Existing CID', 'pending', 'Enter a bytes32 CID from an existing festival...')
  try {
    const { useBulletinStorage } = await import('@festival/shared/metadata/bulletin')
    const { readContract } = await import('@festival/shared/contracts/read')
    const { FESTIVAL_ADDRESS } = await import('@festival/shared/contracts/addresses')

    if (FESTIVAL_ADDRESS === '0x0000000000000000000000000000000000000000') {
      updateLog(id, 'error', 'No festival address configured')
      return
    }

    updateLog(id, 'pending', `Reading metadataCid from ${FESTIVAL_ADDRESS.slice(0, 12)}...`)

    const { FestivalABI } = await import('@festival/shared/contracts/abis')
    let cidBytes32: string
    try {
      cidBytes32 = await readContract({
        address: FESTIVAL_ADDRESS,
        abi: FestivalABI,
        functionName: 'metadataCid',
      }) as string
    } catch (e: any) {
      updateLog(id, 'error', `Contract read failed (ABI mismatch?): ${e.message?.slice(0, 100)}`)
      return
    }

    updateLog(id, 'pending', `Got CID: ${String(cidBytes32).slice(0, 30)}...\nRetrieving via retrievePlaintext (isInHost: ${isInHost()})...`)

    const storage = useBulletinStorage()
    const metadata = await storage.retrievePlaintext(String(cidBytes32))
    updateLog(id, 'success', [
      `Retrieve path: ${isInHost() ? 'preimageManager' : 'IPFS fetch'}`,
      `bytes32: ${String(cidBytes32)}`,
      `Metadata: ${JSON.stringify(metadata).slice(0, 200)}`,
    ].join('\n'))
  } catch (e: any) {
    updateLog(id, 'error', e.message || JSON.stringify(e))
  }
}

// ── Test: Push Notification ─────────────────────────────────────
async function testNotification() {
  const id = log('Notification', 'pending', 'Sending...')
  try {
    const sent = await sendNotification('Debug test from festival admin', '/#/debug')
    updateLog(id, sent ? 'success' : 'error', sent ? 'Notification sent!' : 'Not in host or send failed')
  } catch (e: any) {
    updateLog(id, 'error', e.message)
  }
}

// Last scheduled notification id (for the Cancel button below)
const lastScheduledId = ref<NotificationId | null>(null)

async function testScheduleNotification() {
  const fireAt = Date.now() + 60_000
  const id = log('Schedule Notification', 'pending', `Scheduling for ${new Date(fireAt).toLocaleTimeString()}...`)
  try {
    const result = await pushNotification({
      text: 'Debug scheduled notification (60s)',
      deeplink: '/#/debug',
      scheduledAt: fireAt,
    })
    if (result === SCHEDULE_LIMIT_REACHED) {
      updateLog(id, 'error', 'ScheduleLimitReached — host queue full')
    } else if (result === null) {
      updateLog(id, 'error', 'Not in host or push failed')
    } else {
      lastScheduledId.value = result
      updateLog(id, 'success', `Scheduled. NotificationId=${result}`)
    }
  } catch (e: any) {
    updateLog(id, 'error', e.message || JSON.stringify(e))
  }
}

async function testCancelNotification() {
  if (lastScheduledId.value === null) {
    log('Cancel Notification', 'error', 'No scheduled id — call Schedule first')
    return
  }
  const id = log('Cancel Notification', 'pending', `Cancelling id=${lastScheduledId.value}...`)
  try {
    await cancelNotification(lastScheduledId.value)
    updateLog(id, 'success', `Cancelled id=${lastScheduledId.value}`)
    lastScheduledId.value = null
  } catch (e: any) {
    updateLog(id, 'error', e.message || JSON.stringify(e))
  }
}

function clearLogs() {
  logs.value = []
}
</script>

<template>
  <div v-if="!isDev" />
  <div v-else class="max-w-3xl mx-auto p-6 space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold">Host Integration Debug</h1>
      <span class="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-800 font-mono">TEMPORARY</span>
    </div>

    <!-- Tests Grid -->
    <div class="grid grid-cols-2 gap-3">
      <button @click="testEnvironment" class="px-3 py-2.5 text-sm font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 active:bg-gray-100 transition-colors text-left">Environment Info</button>
      <button @click="testFeatureCheck" class="px-3 py-2.5 text-sm font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 active:bg-gray-100 transition-colors text-left">Feature Check</button>
      <button @click="testPermissionCamera" class="px-3 py-2.5 text-sm font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 active:bg-gray-100 transition-colors text-left">Permission: Camera</button>
      <button @click="testPermissionRemote" class="px-3 py-2.5 text-sm font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 active:bg-gray-100 transition-colors text-left">Permission: Remote</button>
      <button @click="testContractRead" class="px-3 py-2.5 text-sm font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 active:bg-gray-100 transition-colors text-left">Contract Read (Balance)</button>
      <button @click="testSystemRemark" class="px-3 py-2.5 text-sm font-medium rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors text-left">System.remark (signSubmitAndWatch)</button>
      <button @click="testCreateTransaction" class="px-3 py-2.5 text-sm font-medium rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 transition-colors text-left">System.remark (createTransaction)</button>
      <button @click="testSignRaw" class="px-3 py-2.5 text-sm font-medium rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors text-left">signRaw (Message)</button>
      <button @click="testPreimage" class="px-3 py-2.5 text-sm font-medium rounded-lg border border-purple-200 bg-purple-50 hover:bg-purple-100 transition-colors text-left">Preimage Submit + Lookup</button>
      <button @click="testBulletinRoundTrip" class="px-3 py-2.5 text-sm font-medium rounded-lg border border-purple-200 bg-purple-50 hover:bg-purple-100 transition-colors text-left">Bulletin Round-trip (store→retrieve)</button>
      <button @click="testRetrieveExistingCid" class="px-3 py-2.5 text-sm font-medium rounded-lg border border-purple-200 bg-purple-50 hover:bg-purple-100 transition-colors text-left">Retrieve Existing CID (pre-migration)</button>
      <button @click="testNotification" class="px-3 py-2.5 text-sm font-medium rounded-lg border border-green-200 bg-green-50 hover:bg-green-100 transition-colors text-left">Push Notification</button>
      <button @click="testScheduleNotification" class="px-3 py-2.5 text-sm font-medium rounded-lg border border-green-200 bg-green-50 hover:bg-green-100 transition-colors text-left">Schedule Notification (+60s)</button>
      <button @click="testCancelNotification" class="px-3 py-2.5 text-sm font-medium rounded-lg border border-green-200 bg-green-50 hover:bg-green-100 transition-colors text-left">Cancel Last Scheduled</button>
    </div>

    <!-- Log Output -->
    <div class="border rounded-lg overflow-hidden">
      <div class="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
        <span class="text-sm font-medium">Logs</span>
        <button @click="clearLogs" class="text-xs text-gray-500 hover:text-gray-700">Clear</button>
      </div>
      <div class="max-h-[500px] overflow-y-auto divide-y">
        <div v-if="logs.length === 0" class="px-4 py-8 text-center text-gray-400 text-sm">
          Click a test button above
        </div>
        <div
          v-for="entry in logs"
          :key="entry.id"
          class="px-4 py-3 text-sm"
          :class="{
            'bg-white': entry.status === 'pending',
            'bg-green-50': entry.status === 'success',
            'bg-red-50': entry.status === 'error',
          }"
        >
          <div class="flex items-center gap-2 mb-1">
            <span class="font-mono text-xs text-gray-400">{{ entry.time }}</span>
            <span class="font-medium">{{ entry.test }}</span>
            <span
              class="text-xs px-1.5 py-0.5 rounded"
              :class="{
                'bg-yellow-100 text-yellow-700': entry.status === 'pending',
                'bg-green-100 text-green-700': entry.status === 'success',
                'bg-red-100 text-red-700': entry.status === 'error',
              }"
            >
              {{ entry.status }}
            </span>
          </div>
          <pre class="text-xs text-gray-600 whitespace-pre-wrap font-mono">{{ entry.message }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

