import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { VenueMarker } from '@festival/shared/metadata/schemas'
import type { PickedLocation } from '@festival/shared/venue/floors'
import { SESSION_LOCATION_ALLOWED_TYPES } from '@festival/shared/venue/categories'
import {
  findVenueConflict,
  findBusyMarkerIds,
  type VenueConflictItem,
} from '@festival/shared/sessions/venueConflict'
import { berlinMinuteToDate } from '@festival/shared'
import { useSubEvents } from './useSubEvents'
import { useSchedule } from './useSchedule'

interface Options {
  dateKey: MaybeRefOrGetter<string>
  startMinutesOfDay: MaybeRefOrGetter<number | null>
  endMinutesOfDay: MaybeRefOrGetter<number | null>
  venueMarkers: MaybeRefOrGetter<VenueMarker[]>
  pickedLocation: MaybeRefOrGetter<PickedLocation | null>
  /** Sub-event address to exclude (the one being edited). */
  excludeAddress?: string
}

/**
 * Shared venue-conflict wiring for the session create + edit flows.
 *
 * - `busyMarkerIds` is the set of markers already booked in the candidate
 *   window — pass it to the location picker so it can grey/toast them.
 * - `detectConflict()` runs the final check at submit time against the
 *   currently picked marker, returning the first overlap or null.
 */
export function useSessionVenueConflict(opts: Options) {
  const { subEvents } = useSubEvents()
  const { entries: scheduleEntries } = useSchedule()

  const candidateWindow = computed<{ startSec: number; endSec: number } | null>(() => {
    const dateKey = toValue(opts.dateKey)
    const startMin = toValue(opts.startMinutesOfDay)
    const endMin = toValue(opts.endMinutesOfDay)
    if (!dateKey || startMin == null || endMin == null) return null
    const startSec = Math.floor(berlinMinuteToDate(dateKey, startMin).getTime() / 1000)
    const endSec = Math.floor(berlinMinuteToDate(dateKey, endMin).getTime() / 1000)
    return { startSec, endSec }
  })

  const allowedMarkerIds = computed(() =>
    toValue(opts.venueMarkers)
      .filter((m) => SESSION_LOCATION_ALLOWED_TYPES.has(m.type))
      .map((m) => m.id),
  )

  const busyMarkerIds = computed<Set<string>>(() => {
    const w = candidateWindow.value
    if (!w) return new Set()
    return findBusyMarkerIds(
      w.startSec,
      w.endSec,
      allowedMarkerIds.value,
      subEvents.value,
      scheduleEntries.value,
      toValue(opts.venueMarkers),
      opts.excludeAddress,
    )
  })

  function detectConflict(): VenueConflictItem | null {
    const picked = toValue(opts.pickedLocation)
    const w = candidateWindow.value
    if (!picked?.markerId || !w) return null
    return findVenueConflict(
      picked.markerId,
      w.startSec,
      w.endSec,
      subEvents.value,
      scheduleEntries.value,
      toValue(opts.venueMarkers),
      opts.excludeAddress,
    )
  }

  return { candidateWindow, busyMarkerIds, detectConflict }
}
