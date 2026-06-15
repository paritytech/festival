import { AbiEvent } from 'ox'
import { useMainClient } from '../host/client'
import { FestivalABI } from '../contracts/abis'

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let hex = '0x'
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex as `0x${string}`
}

export interface FestivalEventHandlers {
  onMetadataUpdated?: (newCid: `0x${string}`) => void
  onChannelMetadataUpdated?: (newCid: `0x${string}`) => void
  onRegistered?: (attendee: string, tokenId: bigint) => void
  onCheckedIn?: (attendee: string) => void
  onSessionCreated?: (sessionAddr: string, creator: string, metadataCid: `0x${string}`) => void
  onCapacityUpdated?: (newCapacity: number) => void
  onCancelled?: () => void
}

// Event names we watch for
const WATCHED_EVENTS = [
  'MetadataUpdated',
  'ChannelMetadataUpdated',
  'Registered',
  'CheckedIn',
  'SessionCreated',
  'CapacityUpdated',
  'FestivalCancelled',
] as const

// 10s is slow enough not to feed the host's rate limiter into a hot loop, fast
// enough to recover quickly from transient errors.
const RETRY_DELAY_MS = 10_000

// Pre-computed topic0 → event lookup map (built once at module init)
const EVENT_TOPIC_MAP = new Map<string, { name: string; abi: any }>()
for (const name of WATCHED_EVENTS) {
  const abi = FestivalABI.find(
    (item: any) => item.type === 'event' && item.name === name,
  )
  if (abi) {
    const topic0 = AbiEvent.encode(abi as any).topics[0] as string
    EVENT_TOPIC_MAP.set(topic0, { name, abi })
  }
}

/**
 * Subscribe to Revive.ContractEmitted events for a Festival contract.
 *
 * Uses PAPI v2's `watchBest()`. One emission per best block, with all matching
 * events for that block. We process only `type === 'new'` (drop reorg replays
 * and finalized re-emissions): all watched events here are monotonic
 * (POAP mint, registration, metadata-CID update, capacity bump, cancellation),
 * so re-applying on reorg recovery is a no-op.
 *
 * Auto-retries on transient errors (BlockNotPinnedError).
 */
export function watchFestivalEvents(
  festivalAddress: `0x${string}`,
  handlers: FestivalEventHandlers,
): { unsubscribe: () => void } {
  const { api } = useMainClient()
  const normalizedAddress = festivalAddress.toLowerCase()
  let subscription: { unsubscribe: () => void } | null = null
  let retryTimeout: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  function dispatchEvent(name: string, decoded: any) {
    switch (name) {
      case 'MetadataUpdated':
        handlers.onMetadataUpdated?.(decoded.newCid as `0x${string}`)
        break
      case 'ChannelMetadataUpdated':
        handlers.onChannelMetadataUpdated?.(decoded.newCid as `0x${string}`)
        break
      case 'Registered':
        handlers.onRegistered?.(decoded.attendee as string, decoded.tokenId as bigint)
        break
      case 'CheckedIn':
        handlers.onCheckedIn?.(decoded.attendee as string)
        break
      case 'SessionCreated':
        handlers.onSessionCreated?.(
          decoded.session as string,
          decoded.creator as string,
          decoded.metadataCid as `0x${string}`,
        )
        break
      case 'CapacityUpdated':
        handlers.onCapacityUpdated?.(Number(decoded.newCapacity))
        break
      case 'FestivalCancelled':
        handlers.onCancelled?.()
        break
    }
  }

  function processEvent(event: any) {
    try {
      const body = event?.payload ?? event
      if (!body?.contract) return
      // PAPI v2: H160 (FixedSizeBinary) decodes to a hex string, H256 topics
      // likewise; only Vec<u8> `data` arrives as Uint8Array.
      const contractHex = (typeof body.contract === 'string'
        ? body.contract
        : (body.contract as any).asHex?.() ?? '') as string
      if (contractHex.toLowerCase() !== normalizedAddress) return
      if (!body?.topics || !body?.data) return

      const topics = body.topics.map((t: any): `0x${string}` =>
        (typeof t === 'string' ? t : t.asHex?.() ?? '') as `0x${string}`,
      )
      const data: `0x${string}` = body.data instanceof Uint8Array
        ? bytesToHex(body.data)
        : ((body.data as any).asHex?.() ?? body.data)

      const match = EVENT_TOPIC_MAP.get(topics[0])
      if (!match) return

      try {
        const decoded = AbiEvent.decode(match.abi, { data, topics }) as any
        dispatchEvent(match.name, decoded)
      } catch {
        // Decode failed. Skip event
      }
    } catch (e) {
      console.error('[FestivalWatcher] Error processing event:', e)
    }
  }

  function subscribe() {
    if (stopped) return

    // Dispose any prior subscription before opening a new one. This covers the
    // retry-after-error path. If we don't tear down first, each retry leaks
    // another chainHead follow and we exhaust the host's follow budget.
    if (subscription) {
      try {
        subscription.unsubscribe()
      } catch (e) {
        console.warn('[FestivalWatcher] prior unsubscribe threw:', e)
      }
      subscription = null
    }

    subscription = api.event.Revive.ContractEmitted
      .watchBest()
      .subscribe({
        next: ({ type, events }: { type: 'new' | 'drop' | 'finalized'; events: any[] }) => {
          if (type !== 'new') return
          if (!events || events.length === 0) return
          for (const event of events) {
            processEvent(event)
          }
        },
        error: (err: Error) => {
          // The observable has errored. RxJS guarantees the stream is torn
          // down. Null our reference so the next subscribe() call doesn't
          // mistake this for a leaked subscription.
          subscription = null
          console.warn(`[FestivalWatcher] subscribe error — will resubscribe in ${RETRY_DELAY_MS}ms: ${err.message}`)
          if (!stopped) {
            if (retryTimeout) clearTimeout(retryTimeout)
            retryTimeout = setTimeout(subscribe, RETRY_DELAY_MS)
          }
        },
      })
  }

  subscribe()

  return {
    unsubscribe: () => {
      stopped = true
      if (retryTimeout) {
        clearTimeout(retryTimeout)
        retryTimeout = null
      }
      if (subscription) {
        subscription.unsubscribe()
        subscription = null
      }
    },
  }
}
