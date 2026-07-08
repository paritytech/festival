import { onUnmounted, getCurrentInstance, watch, type Ref, type WatchStopHandle } from 'vue'
import { onMainClientReset } from '../host/client'
import type { FestivalMetadata, SubEventMetadata } from '../metadata/schemas'
import { hydrateSubEventMetadata } from '../metadata/schemas'
import { useBulletinStorage } from '../metadata/bulletin'
import { isNonZeroCid } from '../contracts/festival-reads'
import { batchRead } from '../contracts/multicall'
import { FestivalSessionABI } from '../contracts/abis'
import { watchContractEvents, type FestivalEventHandlers } from './event-watcher'
import {
  festivalState,
  applyMetadataUpdated,
  applyRegistered,
  applyCheckedIn,
  applyCapacityUpdated,
  applyCancelled,
  applySessionCreated,
  applySessionDetails,
  applySessionMetadata,
  applySessionRegistered,
  applySessionCheckedIn,
  applySessionMetadataUpdated,
} from './festival-state'

export interface FestivalWatcherOptions {
  /** Admin drift notification callback (toast). */
  onDriftDetected?: (msg: string) => void
  /** Fired when the festival's channel CID pointer updates on chain. */
  onChannelMetadataUpdated?: (newCid: `0x${string}`) => void
  /** Fired on a festival-level CheckedIn (after state applied). Lets the app
   * refresh the checked-in user's festival POAP without a full reconcile. */
  onCheckedIn?: (attendee: string) => void
  /** Fired on a session-level CheckedIn (after state applied), for the same
   * per-user POAP refresh on the session contract. */
  onSessionCheckedIn?: (sessionAddress: `0x${string}`, attendee: string) => void
  /**
   * If provided, the watcher is held off until this ref flips to false.
   * Lets callers invoke the composable during setup (so onUnmounted registers)
   * while still deferring the chainHead follow until initial reads complete.
   */
  deferWhileLoading?: Ref<boolean>
}

/**
 * Real-time contract event subscription. Mutates `festivalState` in place via
 * `apply*` helpers; reactive composables observing the state pick changes up
 * automatically. Call once at app top level. Cleanup runs on unmount.
 */
export function useFestivalWatcher(
  festivalAddress: `0x${string}`,
  options: FestivalWatcherOptions = {},
) {
  const instance = getCurrentInstance()
  if (!instance) {
    console.error(`[FestivalWatcher] useFestivalWatcher: called OUTSIDE setup — cleanup cannot register. This is a bug: move the call to script-setup top level and pass deferWhileLoading instead.`)
    return
  }

  const { deferWhileLoading, onChannelMetadataUpdated, onCheckedIn, onSessionCheckedIn } = options

  let active: { unsubscribe: () => void } | null = null
  let disposed = false
  let started = false
  let stopDeferWatch: WatchStopHandle | null = null

  function start() {
    if (disposed || active) return
    started = true
    active = buildHandlers()
  }

  function stop() {
    disposed = true
    if (stopDeferWatch) {
      stopDeferWatch()
      stopDeferWatch = null
    }
    unregisterReset()
    if (active) {
      active.unsubscribe()
      active = null
    }
  }

  // Tear down the current chainHead follow and open a fresh one. The host can
  // silently pause the WebSocket while backgrounded; on resume the existing
  // follow may be dead with no error emitted, so the visibility handler calls
  // this after reconciling to guarantee live updates resume.
  //
  // Also driven by resetMainClient(): watchContractEvents captured `api` from
  // the now-destroyed client, so we must rebuild — buildHandlers() re-calls
  // useMainClient() and binds the follow to the freshly built client.
  function restart() {
    // Don't open the follow before the initial (possibly deferred) start has
    // run — a reset during the boot-defer window must not pre-empt the gate.
    if (disposed || !started) return
    if (active) {
      active.unsubscribe()
      active = null
    }
    active = buildHandlers()
  }

  // Re-follow on the rebuilt client when a wedged connection is reset elsewhere
  // (e.g. the session check-in recovery path).
  const unregisterReset = onMainClientReset(restart)

  const normalizedFestival = festivalAddress.toLowerCase()

  // Session contract handlers route the same event names into the session-scoped
  // apply helpers. Rebuilt per event (cheap) so a session created mid-session is
  // covered without re-subscribing the follow.
  function makeSessionHandlers(sessionAddr: `0x${string}`): FestivalEventHandlers {
    return {
      onRegistered: (attendee) => {
        applySessionRegistered(sessionAddr, attendee as `0x${string}`)
      },
      onCheckedIn: (attendee) => {
        applySessionCheckedIn(sessionAddr, attendee as `0x${string}`)
        onSessionCheckedIn?.(sessionAddr, attendee)
      },
      onMetadataUpdated: async (newCid) => {
        if (!isNonZeroCid(newCid)) return
        let metadata: SubEventMetadata | null = null
        try {
          const { retrievePlaintext } = useBulletinStorage()
          metadata = hydrateSubEventMetadata(await retrievePlaintext<SubEventMetadata>(newCid))
        } catch (e) {
          console.warn('[FestivalWatcher] session metadata fetch failed:', e)
        }
        applySessionMetadataUpdated(sessionAddr, newCid, metadata)
      },
    }
  }

  function buildHandlers() {
    const festivalHandlers: FestivalEventHandlers = {
      onMetadataUpdated: async (newCid) => {
        let newMetadata: FestivalMetadata | null = null
        try {
          const { retrievePlaintext } = useBulletinStorage()
          newMetadata = await retrievePlaintext<FestivalMetadata>(newCid)
        } catch (e) {
          console.warn('[FestivalWatcher] Failed to fetch updated metadata:', e)
        }
        applyMetadataUpdated(newCid, newMetadata)
      },

      onChannelMetadataUpdated: (newCid) => {
        onChannelMetadataUpdated?.(newCid)
      },

      onRegistered: (attendee) => {
        applyRegistered(attendee as `0x${string}`)
      },

      onCheckedIn: (attendee) => {
        applyCheckedIn(attendee as `0x${string}`)
        onCheckedIn?.(attendee)
      },

      onSessionCreated: async (sessionAddr, creator, metadataCid) => {
        applySessionCreated(
          sessionAddr as `0x${string}`,
          creator as `0x${string}`,
          metadataCid,
        )
        // Pull the session's real details so subject devices place it in the
        // right program slot now, not just after the next bootLoad. flag fields
        // arrive with that load; zeros here never regress under mergeSession.
        try {
          const [d] = (await batchRead([
            { address: sessionAddr as `0x${string}`, abi: FestivalSessionABI, functionName: 'getEventDetails' },
          ])) as [readonly [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`, bigint, bigint, boolean, bigint]]
          applySessionDetails(sessionAddr as `0x${string}`, {
            metadataCid: d[0],
            creator: d[1],
            poapContract: d[2],
            parentFestival: d[3],
            startTime: d[4],
            endTime: d[5],
            cancelled: d[6],
            registeredCount: d[7],
            flagCount: 0n,
            flagThreshold: 0n,
          })
        } catch (e) {
          console.warn('[FestivalWatcher] session details fetch failed:', e)
        }
        // Fetch the metadata so the card shows a title right away. Skip when
        // the entry already moved past the creation cid, and pass the cid so
        // a fetch that raced a newer update cannot apply old content.
        const entryCid = festivalState.sessions
          .find((s) => s.address.toLowerCase() === sessionAddr.toLowerCase())
          ?.details.metadataCid.toLowerCase()
        if (isNonZeroCid(metadataCid) && entryCid === metadataCid.toLowerCase()) {
          try {
            const { retrievePlaintext } = useBulletinStorage()
            const raw = await retrievePlaintext<SubEventMetadata>(metadataCid)
            applySessionMetadata(sessionAddr as `0x${string}`, hydrateSubEventMetadata(raw), metadataCid)
          } catch (e) {
            console.warn('[FestivalWatcher] session metadata fetch failed:', e)
          }
        }
      },

      onCapacityUpdated: (newCapacity) => {
        applyCapacityUpdated(newCapacity)
      },

      onCancelled: () => {
        applyCancelled()
      },
    }

    // One follow, dispatch by emitting contract: the festival, or any session
    // currently in state. The session set is read per event, so newly created
    // sessions are covered without re-subscribing.
    return watchContractEvents((contract) => {
      if (contract === normalizedFestival) return festivalHandlers
      if (festivalState.sessions.some((s) => s.address.toLowerCase() === contract)) {
        return makeSessionHandlers(contract as `0x${string}`)
      }
      return null
    })
  }

  onUnmounted(stop)

  if (deferWhileLoading) {
    if (!deferWhileLoading.value) {
      start()
    } else {
      stopDeferWatch = watch(
        deferWhileLoading,
        (loading) => {
          if (!loading) {
            start()
            stopDeferWatch?.()
            stopDeferWatch = null
          }
        },
        { flush: 'post' },
      )
    }
  } else {
    start()
  }

  // Reserved for future use: drift detection driven by reconcile diffs.
  void options.onDriftDetected

  return { restart }
}
