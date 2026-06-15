import { onUnmounted, getCurrentInstance, watch, type Ref, type WatchStopHandle } from 'vue'
import type { FestivalMetadata, SubEventMetadata } from '../metadata/schemas'
import { hydrateSubEventMetadata } from '../metadata/schemas'
import { useBulletinStorage } from '../metadata/bulletin'
import { hasDeployedContracts, isNonZeroCid } from '../contracts/festival-reads'
import { watchFestivalEvents } from './event-watcher'
import {
  festivalState,
  applyMetadataUpdated,
  applyRegistered,
  applyCheckedIn,
  applyCapacityUpdated,
  applyCancelled,
  applySessionCreated,
  applySessionMetadata,
} from './festival-state'

export interface FestivalWatcherOptions {
  /** Admin drift notification callback (toast). */
  onDriftDetected?: (msg: string) => void
  /** Fired when the festival's channel CID pointer updates on chain. */
  onChannelMetadataUpdated?: (newCid: `0x${string}`) => void
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
  if (!hasDeployedContracts()) return

  const instance = getCurrentInstance()
  if (!instance) {
    console.error(`[FestivalWatcher] useFestivalWatcher: called OUTSIDE setup — cleanup cannot register. This is a bug: move the call to script-setup top level and pass deferWhileLoading instead.`)
    return
  }

  const { deferWhileLoading, onChannelMetadataUpdated } = options

  let active: { unsubscribe: () => void } | null = null
  let disposed = false
  let stopDeferWatch: WatchStopHandle | null = null

  function start() {
    if (disposed || active) return
    active = buildHandlers()
  }

  function stop() {
    disposed = true
    if (stopDeferWatch) {
      stopDeferWatch()
      stopDeferWatch = null
    }
    if (active) {
      active.unsubscribe()
      active = null
    }
  }

  // Tear down the current chainHead follow and open a fresh one. The host can
  // silently pause the WebSocket while backgrounded; on resume the existing
  // follow may be dead with no error emitted, so the visibility handler calls
  // this after reconciling to guarantee live updates resume.
  function restart() {
    if (disposed) return
    if (active) {
      active.unsubscribe()
      active = null
    }
    active = buildHandlers()
  }

  function buildHandlers() {
    return watchFestivalEvents(festivalAddress, {
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
      },

      onSessionCreated: async (sessionAddr, creator, metadataCid) => {
        applySessionCreated(
          sessionAddr as `0x${string}`,
          creator as `0x${string}`,
          metadataCid,
        )
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
